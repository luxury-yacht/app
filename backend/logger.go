package backend

import (
	"sync"
	"time"
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
	Timestamp time.Time `json:"timestamp"`
	Level     string    `json:"level"`
	Message   string    `json:"message"`
	Source    string    `json:"source,omitempty"`
}

// Logger manages application logs in memory
type Logger struct {
	mu           sync.RWMutex
	entries      []LogEntry
	maxSize      int
	eventEmitter func(string) // Function to emit log events
}

// NewLogger creates a new logger with specified maximum entries
func NewLogger(maxSize int) *Logger {
	if maxSize <= 0 {
		maxSize = 1000 // Default maximum size
	}
	return &Logger{
		entries: make([]LogEntry, 0, maxSize),
		maxSize: maxSize,
	}
}

// Log adds a log entry with the specified level, message and optional source
func (l *Logger) Log(level LogLevel, message string, source ...string) {
	if l == nil {
		return // Safely handle nil logger
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	entry := LogEntry{
		Timestamp: time.Now(),
		Level:     level.String(),
		Message:   message,
	}

	if len(source) > 0 {
		entry.Source = source[0]
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

	// Emit event if event emitter is set
	if l.eventEmitter != nil {
		l.eventEmitter("log-added")
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
func (l *Logger) SetEventEmitter(emitter func(string)) {
	if l == nil {
		return
	}

	l.mu.Lock()
	defer l.mu.Unlock()
	l.eventEmitter = emitter
}
