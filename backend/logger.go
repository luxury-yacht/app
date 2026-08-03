package backend

import (
	"fmt"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/internal/sentryreporting"
)

// LogLevel represents the severity level of a log entry
type LogLevel int

const (
	LogLevelDebug LogLevel = iota
	LogLevelInfo
	LogLevelWarn
	LogLevelError
)

// String returns the string representation of LogLevel
func (l LogLevel) String() string {
	switch l {
	case LogLevelDebug:
		return "DEBUG"
	case LogLevelInfo:
		return "INFO"
	case LogLevelWarn:
		return "WARN"
	case LogLevelError:
		return "ERROR"
	default:
		return "UNKNOWN"
	}
}

// LogEntry represents a single log entry
type LogEntry struct {
	Sequence    uint64 `json:"sequence"`
	Timestamp   string `json:"timestamp"`
	Level       string `json:"level"`
	Message     string `json:"message"`
	Source      string `json:"source,omitempty"`
	ClusterID   string `json:"clusterId,omitempty"`
	ClusterName string `json:"clusterName,omitempty"`
}

// Logger manages application logs in memory
type Logger struct {
	mu            sync.RWMutex
	entries       []LogEntry
	maxSize       int
	nextSequence  uint64
	eventEmitter  func(string, ...interface{}) // Function to emit log events
	errorReporter sentryreporting.Reporter
}

// NewLogger creates a new logger with specified maximum entries
func NewLogger(maxSize int, reporters ...sentryreporting.Reporter) *Logger {
	if maxSize <= 0 {
		maxSize = 1000 // Default maximum size
	}
	var reporter sentryreporting.Reporter
	if len(reporters) > 0 {
		reporter = reporters[0]
	}
	return &Logger{
		entries:       make([]LogEntry, 0, maxSize),
		maxSize:       maxSize,
		errorReporter: reporter,
	}
}

// Log adds a log entry with the specified level, message, and optional metadata.
// The variadic fields are interpreted as source, cluster ID, and cluster name
// in that order.
func (l *Logger) Log(level LogLevel, message string, source ...string) {
	l.log(level, message, nil, nil, "", source...)
}

func (l *Logger) log(level LogLevel, message string, cause error, recovered any, operation string, source ...string) {
	if l == nil {
		return // Safely handle nil logger
	}

	var emit func(string, ...interface{})
	var emittedSequence uint64
	var reporter sentryreporting.Reporter
	l.mu.Lock()

	l.nextSequence++
	entry := LogEntry{
		Sequence:  l.nextSequence,
		Timestamp: time.Now().Format(time.RFC3339Nano),
		Level:     level.String(),
		Message:   message,
	}
	if len(source) > 0 {
		entry.Source = source[0]
	}
	if len(source) > 1 {
		entry.ClusterID = source[1]
	}
	if len(source) > 2 {
		entry.ClusterName = source[2]
	}

	// Add the entry
	l.entries = append(l.entries, entry)

	// Trim if we exceed max size
	if len(l.entries) > l.maxSize {
		// Re-slice into a fresh buffer so capacity can't grow unbounded
		start := len(l.entries) - l.maxSize
		newEntries := make([]LogEntry, l.maxSize)
		copy(newEntries, l.entries[start:])
		l.entries = newEntries
	}

	emit = l.eventEmitter
	reporter = l.errorReporter
	emittedSequence = entry.Sequence
	l.mu.Unlock()

	// Emit outside the logger lock so event handlers cannot block log writes
	// or deadlock by synchronously reading the logger.
	if emit != nil {
		emit("app-logs:added", AppLogsAddedEvent{Sequence: emittedSequence})
	}
	if level != LogLevelError && reporter != nil && entry.Source != logsources.ErrorCapture {
		data := map[string]any{}
		if entry.ClusterID != "" {
			data["clusterId"] = entry.ClusterID
		}
		if entry.ClusterName != "" {
			data["clusterName"] = entry.ClusterName
		}
		reporter.AddBreadcrumb(sentryreporting.Breadcrumb{
			Category: entry.Source,
			Message:  entry.Message,
			Level:    breadcrumbLevel(level),
			Data:     data,
		})
	}
	// ErrorCapture republishes third-party stderr (klog from client-go and
	// friends). Those lines are not this application failing and their stack is
	// the scraper, so they stay in the local log but never reach the reporter.
	if level == LogLevelError && reporter != nil && entry.Source != logsources.ErrorCapture {
		context := sentryreporting.Context{
			Source:      entry.Source,
			ClusterID:   entry.ClusterID,
			ClusterName: entry.ClusterName,
		}
		if recovered != nil {
			context.Operation = operation
			reporter.CapturePanic(recovered, context)
		} else if cause != nil {
			context.Operation = operation
			reporter.CaptureException(cause, context)
		} else {
			reporter.CaptureLogError(entry.Message, context)
		}
	}
}

func breadcrumbLevel(level LogLevel) string {
	switch level {
	case LogLevelDebug:
		return "debug"
	case LogLevelWarn:
		return "warning"
	default:
		return "info"
	}
}

// Debug logs a debug message
func (l *Logger) Debug(message string, source ...string) {
	l.Log(LogLevelDebug, message, source...)
}

// Info logs an info message
func (l *Logger) Info(message string, source ...string) {
	l.Log(LogLevelInfo, message, source...)
}

// Warn logs a warning message
func (l *Logger) Warn(message string, source ...string) {
	l.Log(LogLevelWarn, message, source...)
}

// Error logs an error message
func (l *Logger) Error(message string, source ...string) {
	l.Log(LogLevelError, message, source...)
}

// ErrorWithCause keeps the original error available to the reporter while the
// local application log retains the operation and error text users expect.
func (l *Logger) ErrorWithCause(err error, message string, source ...string) {
	if err == nil {
		l.Error(message, source...)
		return
	}
	l.log(LogLevelError, fmt.Sprintf("%s: %v", message, err), err, nil, message, source...)
}

// Panic keeps a recovered value available to the reporter while retaining a
// readable error entry in the local application log.
func (l *Logger) Panic(recovered any, message string, source ...string) {
	if recovered == nil {
		l.Error(message, source...)
		return
	}
	l.log(LogLevelError, fmt.Sprintf("%s: %v", message, recovered), nil, recovered, message, source...)
}

// GetEntries returns a copy of all log entries
func (l *Logger) GetEntries() []LogEntry {
	if l == nil {
		return []LogEntry{} // Return empty slice for nil logger
	}

	l.mu.RLock()
	defer l.mu.RUnlock()

	// Return a copy to prevent external modification
	entries := make([]LogEntry, len(l.entries))
	copy(entries, l.entries)
	return entries
}

// GetEntriesSince returns a copy of entries with a sequence greater than sequence.
func (l *Logger) GetEntriesSince(sequence uint64) []LogEntry {
	if l == nil {
		return []LogEntry{}
	}

	l.mu.RLock()
	defer l.mu.RUnlock()

	start := len(l.entries)
	for i, entry := range l.entries {
		if entry.Sequence > sequence {
			start = i
			break
		}
	}

	entries := make([]LogEntry, len(l.entries)-start)
	copy(entries, l.entries[start:])
	return entries
}

// Clear removes all log entries
func (l *Logger) Clear() {
	if l == nil {
		return // Safely handle nil logger
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	l.entries = l.entries[:0] // Clear slice but keep capacity
}

// Count returns the number of log entries
func (l *Logger) Count() int {
	if l == nil {
		return 0 // Return 0 for nil logger
	}

	l.mu.RLock()
	defer l.mu.RUnlock()
	return len(l.entries)
}

// SetEventEmitter sets the function to call when new logs are added
func (l *Logger) SetEventEmitter(emitter func(string, ...interface{})) {
	if l == nil {
		return
	}

	l.mu.Lock()
	defer l.mu.Unlock()
	l.eventEmitter = emitter
}
