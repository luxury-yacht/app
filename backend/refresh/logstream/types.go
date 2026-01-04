package logstream

import (
	"time"

	"github.com/luxury-yacht/app/backend/refresh"
)

// Logger represents the minimal logging interface required by the log streaming subsystem.
type Logger interface {
	Debug(message string, source ...string)
	Info(message string, source ...string)
	Warn(message string, source ...string)
	Error(message string, source ...string)
}

type noopLogger struct{}

func (noopLogger) Debug(string, ...string) {}
func (noopLogger) Info(string, ...string)  {}
func (noopLogger) Warn(string, ...string)  {}
func (noopLogger) Error(string, ...string) {}

// Options captures the parameters for a log streaming session.
type Options struct {
	Namespace   string
	Kind        string
	Name        string
	Container   string
	TailLines   int
	ScopeString string
}

// Entry mirrors the log line payload sent to clients.
type Entry struct {
	Timestamp string `json:"timestamp"`
	Pod       string `json:"pod"`
	Container string `json:"container"`
	Line      string `json:"line"`
	IsInit    bool   `json:"isInit"`
}

// EventPayload is the SSE message envelope emitted to clients.
type EventPayload struct {
	Domain       string                          `json:"domain"`
	Scope        string                          `json:"scope"`
	Sequence     uint64                          `json:"sequence"`
	GeneratedAt  int64                           `json:"generatedAt"`
	Reset        bool                            `json:"reset,omitempty"`
	Entries      []Entry                         `json:"entries,omitempty"`
	Error        string                          `json:"error,omitempty"`
	ErrorDetails *refresh.PermissionDeniedStatus `json:"errorDetails,omitempty"`
}

// containerState keeps track of the last line delivered for a stream to avoid duplicates.
type containerState struct {
	lastTimestamp time.Time
	lastLine      string
}
