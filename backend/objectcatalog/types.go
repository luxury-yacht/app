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
	// ScopeCluster indicates a cluster-scoped resource (no namespace).
	ScopeCluster Scope = "Cluster"
	// ScopeNamespace indicates a namespace-scoped resource.
	ScopeNamespace Scope = "Namespace"
)

// HealthState describes the current health of the catalog sync loop.
type HealthState string

const (
	// HealthStateUnknown represents a catalog that has not completed a sync yet.
	HealthStateUnknown HealthState = "unknown"
	// HealthStateOK indicates the catalog is healthy and up to date.
	HealthStateOK HealthState = "ok"
	// HealthStateDegraded indicates the catalog served stale data because a subset of resources failed to sync.
	HealthStateDegraded HealthState = "degraded"
	// HealthStateError indicates the catalog failed to sync and may be stale.
	HealthStateError HealthState = "error"
)

// HealthStatus summarises the catalog health for diagnostics.
type HealthStatus struct {
	Status              HealthState `json:"status"`
	ConsecutiveFailures int         `json:"consecutiveFailures"`
	LastSync            time.Time   `json:"lastSync"`
	LastSuccess         time.Time   `json:"lastSuccess"`
	LastError           string      `json:"lastError,omitempty"`
	Stale               bool        `json:"stale"`
	FailedResources     int         `json:"failedResources,omitempty"`
}

// Summary represents the lightweight metadata captured for each Kubernetes object.
type Summary struct {
	Kind              string `json:"kind"`
	Group             string `json:"group"`
	Version           string `json:"version"`
	Resource          string `json:"resource"`
	Namespace         string `json:"namespace,omitempty"`
	Name              string `json:"name"`
	UID               string `json:"uid"`
	ResourceVersion   string `json:"resourceVersion"`
	CreationTimestamp string `json:"creationTimestamp"`
	Scope             Scope  `json:"scope"`
	LabelsDigest      string `json:"labelsDigest,omitempty"`
}

// Descriptor captures discovery metadata for a Kubernetes resource handled by the catalog.
type Descriptor struct {
	Group      string
	Version    string
	Resource   string
	Kind       string
	Scope      Scope
	Namespaced bool
}

// GVR returns the full GroupVersionResource for the descriptor.
func (d Descriptor) GVR() schema.GroupVersionResource {
	return schema.GroupVersionResource{
		Group:    d.Group,
		Version:  d.Version,
		Resource: d.Resource,
	}
}

// Dependencies captures collaborators required by the catalog service.
type Dependencies struct {
	Common                       common.Dependencies
	Logger                       Logger
	CapabilityFactory            CapabilityFactory
	Telemetry                    Telemetry
	Now                          func() time.Time
	InformerFactory              informers.SharedInformerFactory
	APIExtensionsInformerFactory apiextinformers.SharedInformerFactory
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
	ResyncInterval             time.Duration
	PageSize                   int
	ListWorkers                int
	NamespaceWorkers           int
	InformerPromotionThreshold int
	EvictionTTL                time.Duration
	StreamingBatchSize         int
	StreamingFlushInterval     time.Duration
}

// QueryOptions controls catalog queries executed against the in-memory cache.
type QueryOptions struct {
	Kinds      []string
	Namespaces []string
	Search     string
	Limit      int
	Continue   string
}

// QueryResult summarises the outcome of a catalog query.
type QueryResult struct {
	Items         []Summary
	ContinueToken string
	TotalItems    int
	ResourceCount int
	Kinds         []string
	Namespaces    []string
}

// PartialSyncError reports that a sync completed with partial failures.
type PartialSyncError struct {
	FailedDescriptors []string
	Err               error
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
