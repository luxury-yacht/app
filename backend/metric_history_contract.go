package backend

import (
	"context"

	"github.com/luxury-yacht/app/backend/metrichistory"
	"github.com/luxury-yacht/app/backend/objectcatalog"
)

// Metrics-tab source settings (docs/plans/metrics-history.md): named sources defined once and
// a per-cluster assignment. These types are both the Wails DTOs and the persisted settings shape.

// MetricSourceMode is how the app reaches a source. Only in-cluster exists until external
// sources (with credentials) arrive.
type MetricSourceMode string

const MetricSourceModeInCluster MetricSourceMode = "in-cluster"

// MetricInClusterTarget is a Prometheus Service reached through the API server's Service proxy,
// using the cluster's kubeconfig login.
type MetricInClusterTarget struct {
	ClusterID  string `json:"clusterId"`
	Namespace  string `json:"namespace"`
	Service    string `json:"service"`
	Port       string `json:"port"`
	Scheme     string `json:"scheme"`
	PathPrefix string `json:"pathPrefix"`
}

// MetricSource is one named metrics source.
type MetricSource struct {
	ID        string                 `json:"id"`
	Name      string                 `json:"name"`
	Mode      MetricSourceMode       `json:"mode"`
	InCluster *MetricInClusterTarget `json:"inCluster,omitempty"`
}

// MetricAssignmentKind is a cluster's source choice. "default" is the absence of a choice and is
// never persisted; "none" explicitly opts the cluster out of any default.
type MetricAssignmentKind string

const (
	MetricAssignmentDefault MetricAssignmentKind = "default"
	MetricAssignmentSource  MetricAssignmentKind = "source"
	MetricAssignmentNone    MetricAssignmentKind = "none"
)

// MetricClusterAssignment is one cluster's source choice. SourceID is set only for "source".
type MetricClusterAssignment struct {
	Kind     MetricAssignmentKind `json:"kind"`
	SourceID string               `json:"sourceId,omitempty"`
}

// MetricSourceSettings is everything Settings → Metrics edits. Assignments holds only clusters
// with an explicit choice, keyed by clusterId.
type MetricSourceSettings struct {
	Sources     []MetricSource                     `json:"sources"`
	Assignments map[string]MetricClusterAssignment `json:"assignments"`
}

// metricSourceRepository is the persistence MetricHistoryService needs from PreferencesService.
// update applies mutate to the current settings under the settings lock and saves only when
// mutate succeeds, so validation and write are one atomic step.
type metricSourceRepository interface {
	readMetricSourceSettings() (MetricSourceSettings, error)
	updateMetricSourceSettings(mutate func(*MetricSourceSettings) error) (MetricSourceSettings, error)
}

// MetricServiceCandidate is a core Service an in-cluster source can point at.
type MetricServiceCandidate struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
}

// metricServiceCatalog is the slice of a cluster's object catalog the Service picker reads.
type metricServiceCatalog interface {
	Query(objectcatalog.QueryOptions) objectcatalog.QueryResult
}

// MetricHistoryRequest asks for one object's history over the SpanMs ending now.
type MetricHistoryRequest struct {
	ClusterID string `json:"clusterId"`
	Group     string `json:"group"`
	Version   string `json:"version"`
	Kind      string `json:"kind"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	SpanMs    int64  `json:"spanMs"`
}

// MetricHistoryMode says where the Metrics tab's data comes from. Sources are never mixed: either
// every graph comes from the source, or the tab shows live metrics-server data.
type MetricHistoryMode string

const (
	MetricHistoryModeSource MetricHistoryMode = "source"
	MetricHistoryModeLive   MetricHistoryMode = "live"
)

// MetricHistoryLiveReason is why a response is live: no source chosen, or the source failed.
type MetricHistoryLiveReason string

const (
	MetricHistoryLiveNoSource    MetricHistoryLiveReason = "noSource"
	MetricHistoryLiveSourceError MetricHistoryLiveReason = "sourceError"
)

// MetricSourceSummary names the source a response came from (or failed at).
type MetricSourceSummary struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// MetricHistoryResponse is either source history on Grid, or live mode with its reason. A failing
// source is a response state with Error set, not a command error.
type MetricHistoryResponse struct {
	Mode       MetricHistoryMode       `json:"mode"`
	LiveReason MetricHistoryLiveReason `json:"liveReason,omitempty"`
	Source     *MetricSourceSummary    `json:"source,omitempty"`
	Error      string                  `json:"error,omitempty"`
	Grid       metrichistory.Grid      `json:"grid"`
	Graphs     []metrichistory.Graph   `json:"graphs"`
}

// MetricSourceTestResult is the outcome of Settings → Metrics "Test connection".
type MetricSourceTestResult struct {
	OK      bool   `json:"ok"`
	Version string `json:"version,omitempty"`
	Error   string `json:"error,omitempty"`
}

// metricQuerier reads one source's Prometheus HTTP API. A Prometheus error reply is returned as
// the body so the caller decodes its reason; transport failures are errors.
type metricQuerier interface {
	QueryRange(ctx context.Context, promql string, grid metrichistory.Grid) ([]byte, error)
	BuildInfo(ctx context.Context) ([]byte, error)
}
