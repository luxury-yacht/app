package eventstream

import (
	"sync"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/resourcemodel"
)

// Logger represents the minimal interface required for streaming telemetry,
// aliased to the canonical internal/applog.Logger.
type Logger = applog.Logger

// Entry represents a single Kubernetes event emitted to streaming subscribers.
type Entry struct {
	ClusterID        string                      `json:"clusterId,omitempty"`
	ClusterName      string                      `json:"clusterName,omitempty"`
	Kind             string                      `json:"kind"`
	Name             string                      `json:"name"`
	UID              string                      `json:"uid,omitempty"`
	ResourceVersion  string                      `json:"resourceVersion,omitempty"`
	Namespace        string                      `json:"namespace"`
	ObjectNamespace  string                      `json:"objectNamespace"`
	ObjectUID        string                      `json:"objectUid,omitempty"`
	ObjectAPIVersion string                      `json:"objectApiVersion,omitempty"`
	InvolvedObject   *resourcemodel.ResourceLink `json:"involvedObject,omitempty"`
	Type             string                      `json:"type"`
	Source           string                      `json:"source"`
	Reason           string                      `json:"reason"`
	Object           string                      `json:"object"`
	Message          string                      `json:"message"`
	Age              string                      `json:"age"`
	CreatedAt        int64                       `json:"createdAt"`
}

// StreamEvent wraps an Entry with its stream sequence identifier.
type StreamEvent struct {
	Entry    Entry
	Sequence uint64
}

// Payload is the JSON envelope delivered to stream consumers.
type Payload struct {
	Domain       string                          `json:"domain"`
	Scope        string                          `json:"scope"`
	Sequence     uint64                          `json:"sequence"`
	GeneratedAt  int64                           `json:"generatedAt"`
	Reset        bool                            `json:"reset,omitempty"`
	Events       []Entry                         `json:"events,omitempty"`
	Total        int                             `json:"total,omitempty"`
	Truncated    bool                            `json:"truncated,omitempty"`
	Error        string                          `json:"error,omitempty"`
	ErrorDetails *refresh.PermissionDeniedStatus `json:"errorDetails,omitempty"`
}

// subscription represents a single consumer of streaming events.
type subscription struct {
	ch     chan StreamEvent
	mu     sync.Mutex
	closed bool
}

func (s *subscription) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.closed {
		s.closed = true
		close(s.ch)
	}
}

type eventDeliveryResult uint8

const (
	eventDelivered eventDeliveryResult = iota
	eventDeliveredAfterDrop
	eventSubscriptionClosed
	eventBacklogFull
)

func (s *subscription) trySend(entry StreamEvent) eventDeliveryResult {
	if s == nil {
		return eventSubscriptionClosed
	}
	// Broadcast retains subscriber references after releasing the manager lock.
	// Serialize channel writes with cancellation on the subscription itself.
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return eventSubscriptionClosed
	}
	select {
	case s.ch <- entry:
		return eventDelivered
	default:
	}

	result := eventDelivered
	// Keep the most recent event when a slow subscriber fills its backlog.
	select {
	case <-s.ch:
		result = eventDeliveredAfterDrop
	default:
	}
	select {
	case s.ch <- entry:
		return result
	default:
		return eventBacklogFull
	}
}
