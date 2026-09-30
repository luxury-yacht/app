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
	ClusterID string
	Namespace string
	Group     string
	Version   string
	Kind      string
	Name      string
	MatchNone bool
	Selection containerlogs.ScopeSelection
	// MaxEntries and MaxBytes are the client buffer's limits. MaxEntries also
	// bounds each container's history.
	MaxEntries int
	MaxBytes   int
	// Resume holds the containers the client already has lines for, each with
	// a cursor at the newest of them. Empty means a full history.
	Resume      []containerTarget
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
// fields carry the pod/container source selection, the client buffer's
// limits, which bound each container's history and the first snapshot, and
// optionally where the client's buffer ends for each container.
type Request struct {
	Scope           string        `json:"scope"`
	SelectedFilters []string      `json:"selectedFilters,omitempty"`
	MatchNone       bool          `json:"matchNone,omitempty"`
	MaxEntries      int           `json:"maxEntries,omitempty"`
	MaxBytes        int           `json:"maxBytes,omitempty"`
	Resume          []ResumePoint `json:"resume,omitempty"`
}

// ResumePoint is where the client's buffer ends for one container: the newest
// log timestamp it holds and the lines it holds at that timestamp, oldest
// first. A session given resume points reads only what follows them.
type ResumePoint struct {
	Pod         string   `json:"pod"`
	Container   string   `json:"container"`
	IsInit      bool     `json:"isInit,omitempty"`
	IsEphemeral bool     `json:"isEphemeral,omitempty"`
	Timestamp   string   `json:"timestamp"`
	Lines       []string `json:"lines"`
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
//
// A session sends its first snapshot as one or more frames: the first carries
// Reset, the last carries SnapshotComplete and the number of history entries
// left out because the client could not hold them (Trimmed). When the request's
// resume points were used, the first frame also carries Resumed: the snapshot
// holds only what follows them and adds to the client's buffer instead of
// replacing it, and RemovedPods names the resumed pods that no longer exist,
// whose lines the client drops. A live frame names a pod deleted during the
// session the same way, once no pod with its name has come back. Live batches and
// warning or issue updates follow. Warnings and Issues, when present, replace
// the previous lists. A frame with Error is fatal and the stream then closes;
// Retryable says whether reconnecting can help.
type EventPayload struct {
	Domain           string                          `json:"domain"`
	Scope            string                          `json:"scope"`
	Sequence         uint64                          `json:"sequence"`
	GeneratedAt      int64                           `json:"generatedAt"`
	Reset            bool                            `json:"reset,omitempty"`
	Resumed          bool                            `json:"resumed,omitempty"`
	RemovedPods      []string                        `json:"removedPods,omitempty"`
	SnapshotComplete bool                            `json:"snapshotComplete,omitempty"`
	Trimmed          int                             `json:"trimmed,omitempty"`
	Entries          []Entry                         `json:"entries,omitempty"`
	Warnings         *[]containerlogs.Warning        `json:"warnings,omitempty"`
	Issues           *[]containerlogs.TargetIssue    `json:"issues,omitempty"`
	Error            string                          `json:"error,omitempty"`
	ErrorDetails     *refresh.PermissionDeniedStatus `json:"errorDetails,omitempty"`
	Retryable        bool                            `json:"retryable,omitempty"`
}
