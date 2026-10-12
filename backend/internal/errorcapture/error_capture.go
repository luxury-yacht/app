/*
 * backend/internal/errorcapture/error_capture.go
 *
 * Routes stderr output from Kubernetes client libraries into the app log.
 * Stderr carries no cluster identity, so it never becomes part of an error
 * returned to a caller.
 */

package errorcapture

import (
	"bytes"
	"flag"
	"io"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/internal/logclassify"
	"k8s.io/klog/v2"
)

// Capture handles stderr output from the Kubernetes client library.
type Capture struct {
	mu          sync.Mutex // protects the capture state below
	originalErr *os.File   // original stderr file descriptor
	pipeReader  *os.File   // read end of the pipe
	pipeWriter  *os.File   // write end of the pipe
	capturing   bool       // indicates if capture is active

	repeatsOnce sync.Once
	repeats     *sessionDeduper // warning/error lines already logged this session
}

var (
	global   *Capture // global capture instance
	initOnce sync.Once
	// callbackMu guards the package-level log sink, read from the capture
	// goroutine and set by tests/app init.
	callbackMu sync.RWMutex
	logSink    func(level string, message string) // function to handle log messages

	forbiddenStatusPattern    = regexp.MustCompile(`\b(?:http(?:/\d(?:\.\d)?)?\s+403|status(?:\s+(?:code|of))?(?:\s*[:=]\s*|\s+)403)\b`)
	expectedConditionPatterns = []*regexp.Regexp{
		regexp.MustCompile(`\bforbidden\b`),
		regexp.MustCompile(`\bpermission\s+denied\b`),
		regexp.MustCompile(`\baccess\s+denied\b`),
		forbiddenStatusPattern,
	}
)

// Init installs a stderr capture for klog/k8s client noise.
func Init() {
	initOnce.Do(func() {
		global = &Capture{}

		klogFlags := flag.NewFlagSet("klog", flag.ContinueOnError)
		klog.InitFlags(klogFlags)
		// Opt into the new klog behavior so that -stderrthreshold is honored even
		// when -logtostderr=true (the default).
		// Ref: kubernetes/klog#212, kubernetes/klog#432
		klogFlags.Set("legacy_stderr_threshold_behavior", "false")
		klogFlags.Set("stderrthreshold", "INFO")
		klogFlags.Set("logtostderr", "true")
		klogFlags.Set("v", "2")

		global.start()
	})
}

// Start begins capturing stderr output.
func (c *Capture) start() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.capturing {
		return
	}

	r, w, err := os.Pipe()
	if err != nil {
		if sink := getLogSink(); sink != nil {
			sink("error", "Failed to create pipe for stderr capture: "+err.Error())
		}
		return
	}

	c.pipeReader = r
	c.pipeWriter = w
	c.originalErr = os.Stderr
	os.Stderr = w
	c.capturing = true

	go c.readPipe()
}

// maxPendingLineBytes bounds the partial-line buffer in readPipe so an
// unterminated, over-long line is flushed rather than accumulated without bound.
// A var (not const) so tests can exercise the valve without a 1 MiB write.
var maxPendingLineBytes = 1 << 20 // 1 MiB

// readPipe continuously reads from the stderr pipe, reassembling complete lines
// across reads. A single Read returns up to 4096 bytes and can end mid-line, so
// processing each raw chunk independently would tear lines. The trailing partial
// line is held in pending until its newline (or EOF, or the size valve) arrives.
func (c *Capture) readPipe() {
	buf := make([]byte, 4096)
	var pending []byte
	for {
		n, err := c.pipeReader.Read(buf)
		if n > 0 {
			pending = c.processPipeChunk(pending, buf[:n])
		}
		if err != nil {
			logPipeReadError(err)
			break
		}
	}
	c.emitToLogSink(pending)
}

func (c *Capture) processPipeChunk(pending, chunk []byte) []byte {
	pending = append(pending, chunk...)
	if index := bytes.LastIndexByte(pending, '\n'); index >= 0 {
		c.emitToLogSink(pending[:index+1])
		pending = append(pending[:0], pending[index+1:]...)
	}
	if len(pending) > maxPendingLineBytes {
		c.emitToLogSink(pending)
		return pending[:0]
	}
	return pending
}

func logPipeReadError(err error) {
	if err == io.EOF {
		return
	}
	if sink := getLogSink(); sink != nil {
		sink("error", "Error reading stderr pipe: "+err.Error())
	}
}

// matchAnyPattern reports whether lower matches at least one regex.
func matchAnyPattern(lower string, patterns []*regexp.Regexp) bool {
	for _, pattern := range patterns {
		if pattern.MatchString(lower) {
			return true
		}
	}
	return false
}

// forEachTrimmedLine iterates through non-empty, trimmed lines in input.
func forEachTrimmedLine(input string, fn func(string)) {
	for line := range strings.SplitSeq(input, "\n") {
		msg := strings.TrimSpace(line)
		if msg == "" {
			continue
		}
		fn(msg)
	}
}

// isExpectedCondition reports permission denials, which stay informational.
func isExpectedCondition(lower string) bool {
	return matchAnyPattern(lower, expectedConditionPatterns)
}

// SetLogSink configures a callback for internal errors emitted by the capture subsystem.
func SetLogSink(fn func(level string, message string)) {
	callbackMu.Lock()
	defer callbackMu.Unlock()
	logSink = fn
}

func getLogSink() func(level string, message string) {
	callbackMu.RLock()
	defer callbackMu.RUnlock()
	return logSink
}

// emitToLogSink sends captured stderr lines to the configured log sink. A
// warning or error that repeats is logged only the first time this session:
// client libraries repeat the same failure on every retry.
func (c *Capture) emitToLogSink(chunk []byte) {
	sink := getLogSink()
	if sink == nil || len(chunk) == 0 {
		return
	}
	forEachTrimmedLine(string(chunk), func(msg string) {
		level := logclassify.Classify(msg)
		if (level == logclassify.LevelError || level == logclassify.LevelWarn) && !c.firstOccurrence(level, msg) {
			return
		}
		if isExpectedCondition(strings.ToLower(msg)) {
			level = logclassify.LevelInfo
		}
		sink(level, msg)
	})
}

// firstOccurrence reports whether this line is new this session. The klog
// header (timestamp, thread, source) is excluded, so a retry's repeat matches.
func (c *Capture) firstOccurrence(level, msg string) bool {
	c.repeatsOnce.Do(func() { c.repeats = newSessionDeduper() })
	return c.repeats.shouldLog(level+"|"+klogMessageBody(msg), time.Now())
}

// klogMessageBody strips a klog header ("E1011 10:00:00.000001 12345 file.go:42] ")
// from msg; other lines are returned unchanged.
func klogMessageBody(msg string) string {
	if _, ok := logclassify.ParseKlogSeverity(msg); !ok {
		return msg
	}
	if index := strings.Index(msg, "] "); index >= 0 {
		return msg[index+2:]
	}
	return msg
}
