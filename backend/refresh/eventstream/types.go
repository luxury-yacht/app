package eventstream

import (
	"sync"
	"time"
)

// Logger represents the minimal interface required for streaming telemetry.
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

// Entry represents a single Kubernetes event emitted to streaming subscribers.
type Entry struct {
	ClusterID       string `json:"clusterId,omitempty"`
	ClusterName     string `json:"clusterName,omitempty"`
	Kind            string `json:"kind"`
	Name            string `json:"name"`
	Namespace       string `json:"namespace"`
	ObjectNamespace string `json:"objectNamespace"`
	Type            string `json:"type"`
	Source          string `json:"source"`
	Reason          string `json:"reason"`
	Object          string `json:"object"`
	Message         string `json:"message"`
	Age             string `json:"age"`
	CreatedAt       int64  `json:"createdAt"`
}

// StreamEvent wraps an Entry with its stream sequence identifier.
type StreamEvent struct {
	Entry    Entry
	Sequence uint64
}

// Payload is the SSE envelope delivered to clients.
type Payload struct {
	Domain      string  `json:"domain"`
	Scope       string  `json:"scope"`
	Sequence    uint64  `json:"sequence"`
	GeneratedAt int64   `json:"generatedAt"`
	Reset       bool    `json:"reset,omitempty"`
	Events      []Entry `json:"events,omitempty"`
	Total       int     `json:"total,omitempty"`
	Truncated   bool    `json:"truncated,omitempty"`
	Error       string  `json:"error,omitempty"`
}

// subscription represents a single consumer of streaming events.
type subscription struct {
	ch        chan StreamEvent
	created   time.Time
	closeOnce sync.Once
}

func (s *subscription) Close() {
	s.closeOnce.Do(func() {
		close(s.ch)
	})
}
