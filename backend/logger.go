package backend

import (
	"fmt"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/internal/errorcapture"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/internal/sentry"
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
	OperationID string `json:"operationId,omitempty"`
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
// The variadic fields are interpreted as source, cluster ID, cluster name, and
// operation ID in that order.
func (l *Logger) Log(level LogLevel, message string, source ...string) {
	l.log(level, message, nil, nil, sentryreporting.Operation{}, source...)
}

type logDispatch struct {
	entry    LogEntry
	emit     func(string, ...interface{})
	reporter sentryreporting.Reporter
}

func logSourceValue(source []string, index int) string {
	if index >= len(source) {
		return ""
	}
	return source[index]
}

func newLogEntry(sequence uint64, level LogLevel, message string, source []string) LogEntry {
	return LogEntry{
		Sequence:    sequence,
		Timestamp:   time.Now().Format(time.RFC3339Nano),
		Level:       level.String(),
		Message:     message,
		Source:      logSourceValue(source, 0),
		ClusterID:   logSourceValue(source, 1),
		ClusterName: logSourceValue(source, 2),
		OperationID: logSourceValue(source, 3),
	}
}

func appendBoundedLogEntry(entries []LogEntry, maxSize int, entry LogEntry) []LogEntry {
	entries = append(entries, entry)
	if len(entries) <= maxSize {
		return entries
	}
	// Re-slice into a fresh buffer so capacity can't grow unbounded.
	start := len(entries) - maxSize
	trimmed := make([]LogEntry, maxSize)
	copy(trimmed, entries[start:])
	return trimmed
}

func (l *Logger) recordLogEntry(level LogLevel, message string, source []string) logDispatch {
	l.mu.Lock()
	defer l.mu.Unlock()

	l.nextSequence++
	entry := newLogEntry(l.nextSequence, level, message, source)
	l.entries = appendBoundedLogEntry(l.entries, l.maxSize, entry)
	return logDispatch{
		entry:    entry,
		emit:     l.eventEmitter,
		reporter: l.errorReporter,
	}
}

func (dispatch logDispatch) emitAddedEvent() {
	if dispatch.emit != nil {
		dispatch.emit(appLogsAddedEventName, AppLogsAddedEvent{Sequence: dispatch.entry.Sequence})
	}
}

func logBreadcrumbData(entry LogEntry) map[string]any {
	data := map[string]any{}
	if entry.ClusterID != "" {
		data["clusterId"] = entry.ClusterID
	}
	if entry.ClusterName != "" {
		data["clusterName"] = entry.ClusterName
	}
	return data
}

func addLogBreadcrumb(reporter sentryreporting.Reporter, entry LogEntry, level LogLevel) {
	reporter.AddBreadcrumb(sentryreporting.Breadcrumb{
		Category:    entry.Source,
		Message:     entry.Message,
		Level:       breadcrumbLevel(level),
		Data:        logBreadcrumbData(entry),
		OperationID: entry.OperationID,
	})
}

func logReportingContext(entry LogEntry) sentryreporting.Context {
	return sentryreporting.Context{
		Source:      entry.Source,
		ClusterID:   entry.ClusterID,
		ClusterName: entry.ClusterName,
		OperationID: entry.OperationID,
	}
}

// Keep capture routing on Logger methods so the reporting privacy boundary
// recognizes these frames as plumbing and preserves the original call site for
// Sentry grouping.
func (l *Logger) captureError(
	dispatch logDispatch,
	cause error,
	recovered any,
	operation sentryreporting.Operation,
) {
	context := logReportingContext(dispatch.entry)
	switch {
	case recovered != nil:
		context.Operation = operation
		dispatch.reporter.CapturePanic(recovered, context)
	case cause != nil:
		context.Operation = operation
		dispatch.reporter.CaptureException(cause, context)
	default:
		dispatch.reporter.CaptureLogError(dispatch.entry.Message, context)
	}
}

func (l *Logger) report(
	dispatch logDispatch,
	level LogLevel,
	cause error,
	recovered any,
	operation sentryreporting.Operation,
) {
	if dispatch.reporter == nil || dispatch.entry.Source == logsources.ErrorCapture {
		return
	}
	if cause != nil && errorcapture.IsExpectedClusterFailure(cause) {
		return
	}
	if level == LogLevelError {
		l.captureError(dispatch, cause, recovered, operation)
		return
	}
	addLogBreadcrumb(dispatch.reporter, dispatch.entry, level)
}

func (l *Logger) log(
	level LogLevel,
	message string,
	cause error,
	recovered any,
	operation sentryreporting.Operation,
	source ...string,
) {
	if l == nil {
		return // Safely handle nil logger
	}

	dispatch := l.recordLogEntry(level, message, source)
	// Emit outside the logger lock so event handlers cannot block log writes
	// or deadlock by synchronously reading the logger.
	dispatch.emitAddedEvent()
	// ErrorCapture republishes third-party stderr (klog from client-go and
	// friends). Those lines are not this application failing and their stack is
	// the scraper, so they stay in the local log but never reach the reporter.
	l.report(dispatch, level, cause, recovered, operation)
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
	l.log(LogLevelError, fmt.Sprintf("%s: %v", message, err), err, nil, sentryreporting.Operation{}, source...)
}

// ErrorWithCauseAndOperation attaches only a structured, privacy-reviewed
// telemetry operation. The local log retains the full human-readable message.
func (l *Logger) ErrorWithCauseAndOperation(
	err error,
	message string,
	operation sentryreporting.Operation,
	source ...string,
) {
	if err == nil {
		l.Error(message, source...)
		return
	}
	l.log(LogLevelError, fmt.Sprintf("%s: %v", message, err), err, nil, operation, source...)
}

// Panic keeps a recovered value available to the reporter while retaining a
// readable error entry in the local application log.
func (l *Logger) Panic(recovered any, message string, source ...string) {
	if recovered == nil {
		l.Error(message, source...)
		return
	}
	l.log(LogLevelError, fmt.Sprintf("%s: %v", message, recovered), nil, recovered, sentryreporting.Operation{}, source...)
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
