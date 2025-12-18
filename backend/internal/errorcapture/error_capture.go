package errorcapture

import (
	"bytes"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"time"

	"k8s.io/klog/v2"
)

// Capture handles stderr output from the Kubernetes client library.
type Capture struct {
	mu          sync.RWMutex
	buffer      *bytes.Buffer
	originalErr *os.File
	pipeReader  *os.File
	pipeWriter  *os.File
	capturing   bool
	lastError   string
	lastErrorMu sync.RWMutex
}

var (
	global       *Capture
	eventEmitter func(string)
	logSink      func(level string, message string)
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
		if c.buffer.Len() > 100000 {
			data := c.buffer.Bytes()
			c.buffer.Reset()
			if len(data) > 50000 {
				c.buffer.Write(data[len(data)-50000:])
			}
		}
		c.mu.Unlock()

		c.captureIfInteresting(string(chunk))
	}
}

func (c *Capture) captureIfInteresting(output string) {
	lower := strings.ToLower(output)
	if strings.Contains(lower, "token") ||
		strings.Contains(lower, "expired") ||
		strings.Contains(lower, "sso") ||
		strings.Contains(lower, "authentication") ||
		strings.Contains(lower, "unauthorized") ||
		strings.Contains(lower, "refresh") {
		c.lastErrorMu.Lock()
		c.lastError = strings.TrimSpace(output)
		c.lastErrorMu.Unlock()
		if eventEmitter != nil {
			eventEmitter(c.lastError)
		}
	}
}

func (c *Capture) recent() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	data := c.buffer.Bytes()
	if len(data) > 5000 {
		data = data[len(data)-5000:]
	}
	return string(data)
}

func (c *Capture) last() string {
	c.lastErrorMu.RLock()
	defer c.lastErrorMu.RUnlock()
	return c.lastError
}

func (c *Capture) clearLast() {
	c.lastErrorMu.Lock()
	c.lastError = ""
	c.lastErrorMu.Unlock()
}

func capturedError() string {
	if global == nil {
		return ""
	}

	if last := global.last(); last != "" {
		defer global.clearLast()
		return last
	}

	recent := global.recent()
	if recent == "" {
		return ""
	}

	lines := strings.Split(recent, "\n")
	for i := len(lines) - 1; i >= 0 && i >= len(lines)-10; i-- {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			continue
		}

		lower := strings.ToLower(line)
		if strings.Contains(lower, "error") ||
			strings.Contains(lower, "failed") ||
			strings.Contains(lower, "unauthorized") ||
			strings.Contains(lower, "forbidden") ||
			strings.Contains(lower, "token") ||
			strings.Contains(lower, "expired") {
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
	if len(extra) > len(orig) || strings.Contains(lower, "token") || strings.Contains(lower, "sso") || strings.Contains(lower, "expired") {
		if !strings.Contains(extra, orig) && !strings.Contains(orig, extra) {
			return fmt.Errorf("%s. STDERR: %s", orig, extra)
		}
		return fmt.Errorf("%s", extra)
	}

	return err
}

// Wait briefly for async stderr processing.
func Wait() { time.Sleep(100 * time.Millisecond) }

// SetEventEmitter configures a callback invoked when interesting errors are captured.
func SetEventEmitter(emitter func(string)) {
	eventEmitter = emitter
}

// SetLogSink configures a callback for internal errors emitted by the capture subsystem.
func SetLogSink(fn func(level string, message string)) {
	logSink = fn
}

func (c *Capture) emitToLogSink(chunk []byte) {
	lines := strings.Split(string(chunk), "\n")
	for _, line := range lines {
		msg := strings.TrimSpace(line)
		if msg == "" {
			continue
		}

		level := "info"
		switch {
		case strings.HasPrefix(msg, "E") || strings.Contains(strings.ToLower(msg), "error"):
			level = "error"
		case strings.HasPrefix(msg, "W") || strings.Contains(strings.ToLower(msg), "warning"):
			level = "warn"
		case strings.HasPrefix(msg, "I"):
			level = "info"
		case strings.HasPrefix(msg, "D"):
			level = "debug"
		}

		logSink(level, msg)
	}
}
