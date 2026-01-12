/*
 * backend/internal/errorcapture/error_capture.go
 *
 * Captures and enhances error messages from Kubernetes client libraries.
 */

package errorcapture

import (
	"bytes"
	"flag"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"
	"sync"

	"k8s.io/klog/v2"
)

// Capture handles stderr output from the Kubernetes client library.
type Capture struct {
	mu          sync.RWMutex  // protects the fields below by ensuring concurrent access is safe
	buffer      *bytes.Buffer // stores captured stderr output
	originalErr *os.File      // original stderr file descriptor
	pipeReader  *os.File      // read end of the pipe
	pipeWriter  *os.File      // write end of the pipe
	capturing   bool          // indicates if capture is active
	lastError   string        // last captured error message
	lastErrorMu sync.RWMutex  // protects lastError by ensuring concurrent access is safe
}

var (
	global       *Capture                            // global capture instance
	eventEmitter func(string)                        // function to emit events
	logSink      func(level string, message string)  // function to handle log messages
	tokenPattern = regexp.MustCompile(`\btokens?\b`) // regex pattern to match token-related errors
)

// Init installs a stderr capture for klog/k8s client noise.
func Init() {
	global = &Capture{buffer: &bytes.Buffer{}}

	klogFlags := flag.NewFlagSet("klog", flag.ContinueOnError)
	klog.InitFlags(klogFlags)
	klogFlags.Set("logtostderr", "true")
	klogFlags.Set("stderrthreshold", "0")
	klogFlags.Set("v", "2")

	global.start()
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
		if logSink != nil {
			logSink("error", "Failed to create pipe for stderr capture: "+err.Error())
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

// readPipe continuously reads from the stderr pipe.
func (c *Capture) readPipe() {
	scanner := make([]byte, 4096)
	for {
		n, err := c.pipeReader.Read(scanner)
		if err != nil {
			if err != io.EOF && logSink != nil {
				logSink("error", "Error reading stderr pipe: "+err.Error())
			}
			break
		}

		if n == 0 {
			continue
		}

		chunk := scanner[:n]
		if logSink != nil {
			c.emitToLogSink(chunk)
		}

		c.mu.Lock()
		c.buffer.Write(chunk)
		trimBuffer(c.buffer, 100000, 50000)
		c.mu.Unlock()

		c.captureIfInteresting(string(chunk))
	}
}

// isAuthRelated determines if a log message is related to authentication or token issues.
func isAuthRelated(lower string) bool {
	// Word-boundary token matching avoids false positives from resource names.
	return tokenPattern.MatchString(lower) ||
		containsAny(lower, "expired", "sso", "authentication", "unauthorized", "forbidden", "permission denied")
}

// containsAny reports whether lower contains any of the provided substrings.
func containsAny(lower string, needles ...string) bool {
	for _, needle := range needles {
		if strings.Contains(lower, needle) {
			return true
		}
	}
	return false
}

// isFallbackErrorLine matches the broader error scan used in capturedError.
func isFallbackErrorLine(lower string) bool {
	return tokenPattern.MatchString(lower) ||
		containsAny(lower, "error", "failed", "unauthorized", "forbidden", "expired")
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

// trimBuffer reduces buffer growth by keeping only the newest bytes.
func trimBuffer(buf *bytes.Buffer, maxLen, keep int) {
	if buf.Len() <= maxLen {
		return
	}
	data := buf.Bytes()
	if keep > len(data) {
		keep = len(data)
	}
	buf.Reset()
	if keep > 0 {
		buf.Write(data[len(data)-keep:])
	}
}

// tailString returns the last max bytes as a string.
func tailString(data []byte, max int) string {
	if len(data) > max {
		data = data[len(data)-max:]
	}
	return string(data)
}

// captureIfInteresting checks if the output contains interesting error messages.
// "Interesting" errors are those related to authentication or token issues, as defined by `isAuthRelated`.
func (c *Capture) captureIfInteresting(output string) {
	forEachTrimmedLine(output, func(msg string) {
		lower := strings.ToLower(msg)
		if !isAuthRelated(lower) {
			return
		}
		c.setLastError(msg)
		if eventEmitter != nil {
			eventEmitter(msg)
		}
	})
}

// recent returns the most recent stderr output captured.
func (c *Capture) recent() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return tailString(c.buffer.Bytes(), 5000)
}

// last returns the most recent interesting error captured.
func (c *Capture) last() string {
	c.lastErrorMu.RLock()
	defer c.lastErrorMu.RUnlock()
	return c.lastError
}

// setLastError stores the last interesting error with locking.
func (c *Capture) setLastError(msg string) {
	c.lastErrorMu.Lock()
	c.lastError = msg
	c.lastErrorMu.Unlock()
}

// clearLast clears the most recent interesting error captured.
func (c *Capture) clearLast() {
	c.setLastError("")
}

// capturedError returns the most recent interesting error captured.
func capturedError() string {
	if global == nil {
		return ""
	}

	if last := global.last(); last != "" {
		global.clearLast()
		return last
	}

	return scanRecentError(global.recent())
}

// scanRecentError returns the last interesting error-ish line from recent stderr output.
func scanRecentError(recent string) string {
	if recent == "" {
		return ""
	}

	lines := strings.Split(recent, "\n")
	for i := len(lines) - 1; i >= 0 && i >= len(lines)-10; i-- {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			continue
		}

		if isFallbackErrorLine(strings.ToLower(line)) {
			return line
		}
	}
	return ""
}

// Enhance augments an error with recent stderr output when helpful.
func Enhance(err error) error {
	if err == nil {
		return nil
	}

	extra := capturedError()
	if extra == "" {
		return err
	}

	orig := err.Error()
	lower := strings.ToLower(extra)
	if len(extra) <= len(orig) && !tokenPattern.MatchString(lower) && !containsAny(lower, "sso", "expired") {
		return err
	}

	if !strings.Contains(extra, orig) && !strings.Contains(orig, extra) {
		return fmt.Errorf("%s. STDERR: %s", orig, extra)
	}
	return fmt.Errorf("%s", extra)
}

// SetEventEmitter configures a callback invoked when interesting errors are captured.
func SetEventEmitter(emitter func(string)) {
	eventEmitter = emitter
}

// SetLogSink configures a callback for internal errors emitted by the capture subsystem.
func SetLogSink(fn func(level string, message string)) {
	logSink = fn
}

// emitToLogSink sends captured error messages to the configured log sink.
func (c *Capture) emitToLogSink(chunk []byte) {
	forEachTrimmedLine(string(chunk), func(msg string) {
		level := "info"
		lower := strings.ToLower(msg)
		switch {
		case strings.HasPrefix(msg, "E") || strings.Contains(lower, "error"):
			level = "error"
		case strings.HasPrefix(msg, "W") || strings.Contains(lower, "warning"):
			level = "warn"
		case strings.HasPrefix(msg, "I"):
			level = "info"
		case strings.HasPrefix(msg, "D"):
			level = "debug"
		}

		logSink(level, msg)
	})
}
