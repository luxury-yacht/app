package containerlogsstream

import (
	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/containerlogs"
	"github.com/luxury-yacht/app/backend/refresh"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// Logger represents the minimal logging interface required by the container
// logs streaming subsystem, aliased to the canonical internal/applog.Logger.
type Logger = applog.Logger

// Options captures the parameters for a container logs streaming session.
type Options struct {
	ClusterID   string
	Namespace   string
	Group       string
	Version     string
	Kind        string
	Name        string
	MatchNone   bool
	Selection   containerlogs.ScopeSelection
	TailLines   int
	ScopeString string
}

// target is the complete identity of the pod or workload the session reads.
func (o Options) target() refresh.ObjectScopeIdentity {
	return refresh.ObjectScopeIdentity{
		Namespace: o.Namespace,
		GVK:       schema.GroupVersionKind{Group: o.Group, Version: o.Version, Kind: o.Kind},
		Name:      o.Name,
	}
}

// Request is the first client frame for a container-logs named stream.
// Scope carries complete cluster and Kubernetes object identity; the remaining
// fields carry the pod/container source selection and the history size.
type Request struct {
	Scope           string   `json:"scope"`
	SelectedFilters []string `json:"selectedFilters,omitempty"`
	MatchNone       bool     `json:"matchNone,omitempty"`
	TailLines       int      `json:"tailLines,omitempty"`
}

// Entry mirrors the log line payload sent to clients.
type Entry struct {
	Timestamp   string `json:"timestamp"`
	Pod         string `json:"pod"`
	Container   string `json:"container"`
	Line        string `json:"line"`
	IsInit      bool   `json:"isInit"`
	IsEphemeral bool   `json:"isEphemeral,omitempty"`
}

// EventPayload is the JSON message envelope emitted to clients.
type EventPayload struct {
	Domain       string                          `json:"domain"`
	Scope        string                          `json:"scope"`
	Sequence     uint64                          `json:"sequence"`
	GeneratedAt  int64                           `json:"generatedAt"`
	Reset        bool                            `json:"reset,omitempty"`
	Entries      []Entry                         `json:"entries,omitempty"`
	Warnings     *[]string                       `json:"warnings,omitempty"`
	Error        string                          `json:"error,omitempty"`
	ErrorDetails *refresh.PermissionDeniedStatus `json:"errorDetails,omitempty"`
}
