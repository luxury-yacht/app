package containerlogsstream

import (
	"time"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/containerlogs"
	"github.com/luxury-yacht/app/backend/refresh"
)

// Logger represents the minimal logging interface required by the container
// logs streaming subsystem, aliased to the canonical internal/applog.Logger.
type Logger = applog.Logger

// Options captures the parameters for a container logs streaming session.
type Options struct {
	ClusterID        string
	Namespace        string
	Group            string
	Version          string
	Kind             string
	Name             string
	PodFilter        string
	PodInclude       string
	PodExclude       string
	SelectedFilters  []string
	MatchNone        bool
	Selection        containerlogs.ScopeSelection
	Container        string
	IncludeInit      bool
	IncludeEphemeral bool
	ContainerState   containerlogs.ContainerStateFilter
	Include          string
	Exclude          string
	PodNameFilter    containerlogs.PodNameFilter
	LineFilter       containerlogs.LineFilter
	TailLines        int
	ScopeString      string
}

// Request is the first client frame for a container-logs named stream.
// Scope carries complete cluster and Kubernetes object identity; the remaining
// fields preserve the existing container and filter controls.
type Request struct {
	Scope            string   `json:"scope"`
	Container        string   `json:"container,omitempty"`
	SelectedFilters  []string `json:"selectedFilters,omitempty"`
	MatchNone        bool     `json:"matchNone,omitempty"`
	Pod              string   `json:"pod,omitempty"`
	PodInclude       string   `json:"podInclude,omitempty"`
	PodExclude       string   `json:"podExclude,omitempty"`
	Include          string   `json:"include,omitempty"`
	Exclude          string   `json:"exclude,omitempty"`
	ContainerState   string   `json:"containerState,omitempty"`
	TailLines        int      `json:"tailLines,omitempty"`
	IncludeInit      *bool    `json:"includeInit,omitempty"`
	IncludeEphemeral *bool    `json:"includeEphemeral,omitempty"`
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

// containerState keeps track of lines delivered at the last timestamp to avoid duplicates.
// When multiple log lines share the same timestamp (common in Java apps), we track all of them
// so that on stream reconnection (using SinceTime which is inclusive), we can skip all
// previously seen lines at that timestamp.
type containerState struct {
	lastTimestamp time.Time
	// linesAtTimestamp tracks all lines seen at lastTimestamp to handle deduplication
	// when multiple lines share the same timestamp.
	linesAtTimestamp map[string]struct{}
}
