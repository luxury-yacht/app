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
	"github.com/luxury-yacht/app/backend/resources/common"
	apiextinformers "k8s.io/apiextensions-apiserver/pkg/client/informers/externalversions"
	"k8s.io/apimachinery/pkg/runtime/schema"
	informers "k8s.io/client-go/informers"
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
}

// Summary represents the lightweight metadata captured for each Kubernetes object.
type Summary struct {
	ClusterID         string `json:"clusterId"`              // stable identifier for the source cluster
	ClusterName       string `json:"clusterName"`            // display name for the source cluster
	Kind              string `json:"kind"`                   // resource kind
	Group             string `json:"group"`                  // resource group
	Version           string `json:"version"`                // resource version
	Resource          string `json:"resource"`               // resource name
	Namespace         string `json:"namespace,omitempty"`    // resource namespace
	Name              string `json:"name"`                   // resource name
	UID               string `json:"uid"`                    // resource UID
	ResourceVersion   string `json:"resourceVersion"`        // resource version
	CreationTimestamp string `json:"creationTimestamp"`      // resource creation timestamp
	Scope             Scope  `json:"scope"`                  // resource scope
	LabelsDigest      string `json:"labelsDigest,omitempty"` // optional digest of resource labels
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

// PermissionChecker gates access to resources based on RBAC.
type PermissionChecker interface {
	// CanListWatch reports whether the current identity can list AND watch the resource.
	CanListWatch(group, resource string) bool
}

// Dependencies captures collaborators required by the catalog service.
type Dependencies struct {
	Common                       common.Dependencies                   // common dependencies
	Logger                       Logger                                // logging service
	CapabilityFactory            CapabilityFactory                     // capability evaluation service
	Telemetry                    Telemetry                             // telemetry service
	Now                          func() time.Time                      // function to get the current time
	InformerFactory              informers.SharedInformerFactory       // Kubernetes informer factory
	APIExtensionsInformerFactory apiextinformers.SharedInformerFactory // Kubernetes API extensions informer factory
	PermissionChecker            PermissionChecker                     // optional; if nil, assumes all permissions granted
	ClusterID                    string                                // stable identifier for the source cluster
	ClusterName                  string                                // display name for the source cluster
}

// Logger is the minimal logging contract required by the catalog.
type Logger interface {
	Debug(msg string, source ...string)
	Info(msg string, source ...string)
	Warn(msg string, source ...string)
	Error(msg string, source ...string)
}

// CapabilityFactory builds capability evaluation services on-demand.
type CapabilityFactory func() *capabilities.Service

// Telemetry captures catalog ingestion metrics.
type Telemetry interface {
	RecordCatalog(enabled bool, itemCount, resourceCount int, duration time.Duration, err error)
}

// Options tunes catalog behaviour; zero values fall back to sensible defaults.
type Options struct {
	ResyncInterval             time.Duration // interval between resyncs
	PageSize                   int           // number of items per page
	ListWorkers                int           // number of workers for listing resources
	NamespaceWorkers           int           // number of workers for processing namespaces
	InformerPromotionThreshold int           // threshold for promoting informers
	EvictionTTL                time.Duration // time-to-live for evicted items
	StreamingBatchSize         int           // number of items per streaming batch
	StreamingFlushInterval     time.Duration // interval between streaming flushes
}

// QueryOptions controls catalog queries executed against the in-memory cache.
type QueryOptions struct {
	Kinds      []string // resource kinds to filter
	Namespaces []string // namespaces to filter
	Search     string   // search term for filtering
	Limit      int      // maximum number of items to return
	Continue   string   // token for continuing a paginated query
}

// KindInfo captures metadata about a resource kind for filtering.
type KindInfo struct {
	Kind       string `json:"kind"`       // resource kind name
	Namespaced bool   `json:"namespaced"` // indicates if the kind is namespace-scoped
}

// QueryResult summarises the outcome of a catalog query.
type QueryResult struct {
	Items         []Summary  // items returned by the query
	ContinueToken string     // token for continuing a paginated query
	TotalItems    int        // total number of items matching the query
	ResourceCount int        // total number of resources matching the query
	Kinds         []KindInfo // resource kinds included in the query
	Namespaces    []string   // namespaces included in the query
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
