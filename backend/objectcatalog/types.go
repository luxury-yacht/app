/*
 * backend/objectcatalog/types.go
 *
 * Catalog types and interfaces.
 */

package objectcatalog

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/capabilities"
	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/luxury-yacht/app/backend/refresh/querypage"
	"github.com/luxury-yacht/app/backend/resources/common"
	apiextinformers "k8s.io/apiextensions-apiserver/pkg/client/informers/externalversions"
	"k8s.io/apimachinery/pkg/runtime/schema"
	informers "k8s.io/client-go/informers"
	gatewayinformers "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions"
)

// Scope describes whether a resource is cluster- or namespace-scoped.
type Scope string

const (
	ScopeCluster   Scope = "Cluster"   // ScopeCluster indicates a cluster-scoped resource (no namespace).
	ScopeNamespace Scope = "Namespace" // ScopeNamespace indicates a namespace-scoped resource.
)

// HealthState describes the current health of the catalog sync loop.
type HealthState string

const (
	HealthStateUnknown  HealthState = "unknown"  // HealthStateUnknown represents a catalog that has not completed a sync yet.
	HealthStateOK       HealthState = "ok"       // HealthStateOK indicates the catalog is healthy and up to date.
	HealthStateDegraded HealthState = "degraded" // HealthStateDegraded indicates the catalog served stale data because a subset of resources failed to sync.
	HealthStateError    HealthState = "error"    // HealthStateError indicates the catalog failed to sync and may be stale.
)

// HealthStatus summarises the catalog health for diagnostics.
type HealthStatus struct {
	Status              HealthState `json:"status"`                    // current health status
	ConsecutiveFailures int         `json:"consecutiveFailures"`       // number of consecutive sync failures
	LastSync            time.Time   `json:"lastSync"`                  // time of the last sync attempt
	LastSuccess         time.Time   `json:"lastSuccess"`               // time of the last successful sync
	LastError           string      `json:"lastError,omitempty"`       // error message from the last sync attempt
	Stale               bool        `json:"stale"`                     // indicates if the catalog is serving stale data
	FailedResources     int         `json:"failedResources,omitempty"` // optional number of resources that failed to sync
	// DeniedResources lists resource types (kubectl-style `resource[.group]`)
	// whose lists were RBAC-forbidden during the last sync — so an RBAC-blocked
	// catalog is distinguishable from an empty cluster. Sorted.
	DeniedResources []string `json:"deniedResources,omitempty"`
}

// Summary represents the lightweight metadata captured for each Kubernetes object.
type Summary struct {
	ClusterID         string       `json:"clusterId"`              // stable identifier for the source cluster
	ClusterName       string       `json:"clusterName"`            // display name for the source cluster
	Kind              string       `json:"kind"`                   // resource kind
	Group             string       `json:"group"`                  // resource group
	Version           string       `json:"version"`                // resource version
	Resource          string       `json:"resource"`               // resource name
	Namespace         string       `json:"namespace,omitempty"`    // resource namespace
	Name              string       `json:"name"`                   // resource name
	UID               string       `json:"uid"`                    // resource UID
	ResourceVersion   string       `json:"resourceVersion"`        // resource version
	CreationTimestamp string       `json:"creationTimestamp"`      // resource creation timestamp
	Scope             Scope        `json:"scope"`                  // resource scope
	LabelsDigest      string       `json:"labelsDigest,omitempty"` // optional digest of resource labels
	ActionFacts       *ActionFacts `json:"actionFacts,omitempty"`  // optional facts needed to present object actions correctly
}

// ActionFacts carries lightweight, action-relevant state for catalog rows.
// Identity stays on Summary; these fields only answer whether a known action
// variant is appropriate for the current object state.
type ActionFacts struct {
	Status               string             `json:"status,omitempty"`
	Unschedulable        *bool              `json:"unschedulable,omitempty"`
	PortForwardAvailable *bool              `json:"portForwardAvailable,omitempty"`
	HPAManaged           *bool              `json:"hpaManaged,omitempty"`
	DesiredReplicas      *int32             `json:"desiredReplicas,omitempty"`
	ScaleTarget          *ActionScaleTarget `json:"-"`
}

// ActionScaleTarget is the target referenced by an autoscaler. It is used by
// backend catalog enrichment and is intentionally not part of the JSON payload.
type ActionScaleTarget struct {
	Group     string
	Version   string
	Kind      string
	Namespace string
	Name      string
}

// Descriptor captures discovery metadata for a Kubernetes resource handled by the catalog.
type Descriptor struct {
	Group      string // resource group
	Version    string // resource version
	Resource   string // resource name
	Kind       string // resource kind
	Scope      Scope  // resource scope
	Namespaced bool   // indicates if the resource is namespaced
}

// GVR returns the full GroupVersionResource for the descriptor.
func (d Descriptor) GVR() schema.GroupVersionResource {
	return schema.GroupVersionResource{
		Group:    d.Group,    // resource group
		Version:  d.Version,  // resource version
		Resource: d.Resource, // resource name
	}
}

// Dependencies captures collaborators required by the catalog service.
type Dependencies struct {
	Common                       common.Dependencies                    // common dependencies
	Logger                       Logger                                 // logging service
	CapabilityFactory            CapabilityFactory                      // capability evaluation service
	Telemetry                    Telemetry                              // telemetry service
	Now                          func() time.Time                       // function to get the current time
	InformerFactory              informers.SharedInformerFactory        // Kubernetes informer factory
	APIExtensionsInformerFactory apiextinformers.SharedInformerFactory  // Kubernetes API extensions informer factory
	GatewayInformerFactory       gatewayinformers.SharedInformerFactory // Gateway API informer factory
	PermissionChecker            permissions.ListWatchChecker           // optional; if nil, assumes all permissions granted
	IngestSource                 IngestSource                           // optional; supplies catalog rows for ingest-owned kinds
	ClusterID                    string                                 // stable identifier for the source cluster
	ClusterName                  string                                 // display name for the source cluster
	// WaitForCaches blocks until the informer caches the collect reads from are
	// synced. sync() calls it between the RBAC preflight and the collect fan-out, so
	// discovery + preflight (pure API calls) overlap the factory's initial sync
	// instead of running after it. nil skips the wait (tests, no factory).
	WaitForCaches func(ctx context.Context) error
	// AllowedNamespaces is the cluster's namespace scope
	// (docs/plans/namespace-scope.md): when non-empty, collection of
	// namespaced kinds runs per configured namespace instead of
	// cluster-wide, and a namespace the identity cannot list is skipped
	// without blanking the others. Empty means cluster-wide (today).
	AllowedNamespaces []string
}

// IngestSource supplies the object-catalog Summaries for ingest-owned (cut) kinds,
// whose objects are no longer cached by the shared informer factory. The catalog
// reads cut kinds' rows from CatalogRows on a full collect, and stays current
// between collects via the Catalog-half sink registered through AddCatalogSink.
// *ingest.IngestManager satisfies it. Reads return Summaries the catalog's own
// projector built at intake (see SummaryProjector), so they are byte-equivalent to
// the shared-informer collect path.
type IngestSource interface {
	CatalogRows(gvr schema.GroupVersionResource) []interface{}
	AddCatalogSink(gvr schema.GroupVersionResource, sink ingest.Sink) bool
	// RegisterDynamicCatalogReflector starts an on-demand reflector for a dynamic
	// (CRD-backed) kind, projecting each object to its catalog Summary via project. The
	// catalog calls it when a CR kind crosses its promotion threshold (maybePromote),
	// consolidating the former catalog-owned dynamic informer onto the ingest path.
	RegisterDynamicCatalogReflector(gvr schema.GroupVersionResource, gvk schema.GroupVersionKind, project ingest.CatalogProjector, namespaced bool) bool
	// StopReflectorFor stops and evicts the on-demand reflector for gvr, the teardown half
	// of the dynamic path (stopDynamicReflectors).
	StopReflectorFor(gvr schema.GroupVersionResource)
	// HasSyncedFor reports whether gvr's store has synced, so the catalog serves a promoted
	// dynamic kind from CatalogRows only once its reflector's initial relist has landed
	// (else it keeps listing — no empty flash).
	HasSyncedFor(gvr schema.GroupVersionResource) bool
}

// Logger is the minimal logging contract required by the catalog, aliased to
// the canonical internal/applog.Logger.
type Logger = applog.Logger

// CapabilityFactory builds capability evaluation services on-demand.
type CapabilityFactory func() *capabilities.Service

// Telemetry captures catalog ingestion metrics.
type Telemetry interface {
	RecordCatalog(enabled bool, itemCount, resourceCount int, duration time.Duration, err error)
}

// Options tunes catalog behaviour; zero values fall back to sensible defaults.
type Options struct {
	ResyncInterval             time.Duration     // interval between resyncs
	FailedSyncRetryInterval    time.Duration     // short retry after a failed/incomplete sync (default config.ObjectCatalogFailedSyncRetryInterval)
	PageSize                   int               // number of items per page
	ListWorkers                int               // number of workers for listing resources
	NamespaceWorkers           int               // number of workers for processing namespaces
	InformerPromotionThreshold int               // threshold for promoting informers
	EvictionTTL                time.Duration     // time-to-live for evicted items
	StreamingBatchSize         int               // number of items per streaming batch
	StreamingFlushInterval     time.Duration     // interval between streaming flushes
	EnableReactiveUpdates      bool              // enables informer-driven incremental updates (default true)
	QueryStore                 CatalogQueryStore // optional query execution backend; defaults to in-memory catalog index
}

// QueryOptions controls catalog queries executed against the in-memory cache.
type QueryOptions struct {
	Kinds         []string // resource kinds to filter
	Namespaces    []string // namespaces to filter
	Search        string   // search term for filtering
	SortField     string   // backend-owned sort field; empty uses the catalog default
	SortDirection string   // backend-owned sort direction; empty uses ascending
	Limit         int      // maximum number of items to return
	Continue      string   // token for continuing a paginated query
	CustomOnly    bool     // restricts results to non-built-in discovered resources
	// Anchor asks for the page CONTAINING this object instead of a
	// cursor-addressed page (mutually exclusive with Continue — the snapshot
	// layer validates before calling). See QueryAnchor.
	Anchor *QueryAnchor
	// StartRank asks for the page starting at this 0-based rank among matching
	// rows (numbered page jumps); the engine clamps past-the-end starts.
	// Mutually exclusive with Continue and Anchor (snapshot layer validates).
	StartRank *int
}

// QueryAnchor identifies an anchored query's jump target. The catalog resolves
// it to a summary by exact group/version/namespace/name and case-insensitive
// kind; UID, when set, is an identity cross-check — a mismatch means the
// object was deleted and recreated, reported as not-found. (Catalog-local
// mirror of the snapshot wire contract's anchor; objectcatalog cannot import
// the snapshot package.)
type QueryAnchor struct {
	Group     string
	Version   string
	Kind      string
	Namespace string
	Name      string
	UID       string
}

// KindInfo captures metadata about a resource kind for filtering.
type KindInfo struct {
	Kind       string `json:"kind"`       // resource kind name
	Namespaced bool   `json:"namespaced"` // indicates if the kind is namespace-scoped
}

// QueryResult summarises the outcome of a catalog query.
type QueryResult struct {
	Items         []Summary // items returned by the query
	ContinueToken string    // token for continuing a paginated query
	PreviousToken string    // token for fetching the previous page
	SelfToken     string    // token addressing THIS page (counted serves only; page-stable refetch)
	CursorInvalid bool      // indicates the supplied cursor was malformed or incompatible
	TotalItems    int       // total number of items matching the query
	// UnfilteredTotal is the in-scope item count before the query's filters (the "of M" in
	// "showing N of M items due to filters"); equals TotalItems when no filter is active.
	UnfilteredTotal int        // in-scope count before the query's filters
	TotalIsExact    bool       // indicates TotalItems is exact for the query
	ResourceCount   int        // total number of resources matching the query
	Kinds           []KindInfo // resource kinds included in the query
	Namespaces      []string   // namespaces included in the query
	FacetsExact     bool       // indicates Kinds and Namespaces describe the matching universe exactly
	// AnchorOutcome reports how an anchored query resolved (nil when the query
	// carried no anchor); the snapshot layer maps it onto the wire contract's
	// found/filtered/not-found result.
	AnchorOutcome *querypage.AnchorOutcome
	// PageStartRank is the 0-based rank of the served page's first row among
	// matching rows; -1 when not computed (cursor-addressed pages).
	PageStartRank int
}

// PartialSyncError reports that a sync completed with partial failures.
type PartialSyncError struct {
	FailedDescriptors []string // descriptors that failed to sync
	Err               error    // underlying error
}

// Error implements the error interface.
func (e *PartialSyncError) Error() string {
	if e == nil {
		return ""
	}
	base := fmt.Sprintf("catalog sync incomplete: %d descriptor(s) failed", len(e.FailedDescriptors))
	if len(e.FailedDescriptors) > 0 {
		base = fmt.Sprintf("%s (%s)", base, strings.Join(e.FailedDescriptors, ", "))
	}
	if e.Err != nil {
		return fmt.Sprintf("%s: %v", base, e.Err)
	}
	return base
}

// Unwrap exposes the underlying error, if any.
func (e *PartialSyncError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

// FailedCount reports the number of descriptors that failed to sync.
func (e *PartialSyncError) FailedCount() int {
	if e == nil {
		return 0
	}
	return len(e.FailedDescriptors)
}

// RunContext couples a context with its cancellation signal.
type RunContext struct {
	Context context.Context
	Cancel  context.CancelFunc
}
