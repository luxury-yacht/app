/*
 * backend/kind/kindspec/descriptor.go
 *
 * The single per-kind Descriptor: a kind's identity plus every typed behaviour the
 * app needs from it (stream summary, object-map node + edges, detail binding) and
 * the facet flags that tell each subsystem how to treat it (catalog source,
 * detail-cache eviction). One registry (kind/kindregistry) aggregates these;
 * every subsystem loops that registry and filters by facet, so no subsystem ever
 * names a kind itself.
 *
 * This package imports only leaves (resourcekind, streamspec, objectmapnode,
 * objectmapspec, appbinding + metav1) and NO kind packages, so a kind can declare
 * its Descriptor without an import cycle.
 */

package kindspec

import (
	"context"

	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/luxury-yacht/app/backend/kind/objectmapspec"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/resourcekind"
	"github.com/luxury-yacht/app/backend/resources/appbinding"
	"github.com/luxury-yacht/app/backend/resources/common"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// WorkloadOperations are a workload kind's mutating actions, declared in the kind's
// package so the action handlers never switch on kind. A nil func means the kind
// does not support that action (e.g. DaemonSet is not scalable; ReplicaSet is not
// rollout-restartable). Each func makes the kind's own typed API call.
type WorkloadOperations struct {
	// Restart applies the rollout-restart patch to the workload's pod template.
	Restart func(ctx context.Context, client kubernetes.Interface, namespace, name string, patch []byte) error
	// Scale sets the workload's desired replica count via its scale subresource.
	Scale func(ctx context.Context, client kubernetes.Interface, namespace, name string, replicas int32) error
	// CurrentReplicas reads the workload's current desired replica count (1 when unset).
	CurrentReplicas func(ctx context.Context, client kubernetes.Interface, namespace, name string) (int32, error)
	// RevisionHistory returns the workload's rollout revision history, newest first.
	RevisionHistory func(ctx context.Context, client kubernetes.Interface, namespace, name string) ([]common.WorkloadRevision, error)
	// ApplyPodTemplate replaces the workload's pod template (used by rollback).
	ApplyPodTemplate func(ctx context.Context, client kubernetes.Interface, namespace, name string, template corev1.PodTemplateSpec) error
}

// scaleSpec builds the autoscaling/v1 Scale a kind's Scale op submits; shared so the
// per-kind ops stay one-liners.
func ScaleObject(namespace, name string, replicas int32) *autoscalingv1.Scale {
	return &autoscalingv1.Scale{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: namespace},
		Spec:       autoscalingv1.ScaleSpec{Replicas: replicas},
	}
}

// ObjectMapGraph holds how a kind behaves in the object-map graph traversal — its
// graph ROLE, not its edges. The object-map walker reads these instead of
// hard-coding kind names: ScalableWorkload kinds carry HPA-managed action facts;
// DirectionalTraversal kinds are graph leaves walked one-way; StopsReverseExpansion
// kinds (cluster-scoped "class" resources) halt reverse namespace-map expansion.
type ObjectMapGraph struct {
	ScalableWorkload      bool
	DirectionalTraversal  bool
	StopsReverseExpansion bool
}

// CatalogSource names how the object catalog lists a kind's objects.
type CatalogSource int

const (
	// CatalogDynamic lists the kind via the dynamic client (no shared informer in
	// the catalog's collection plan). This is the default for kinds with no
	// dedicated informer wired into the catalog.
	CatalogDynamic CatalogSource = iota
	// CatalogShared lists the kind from the core shared informer factory.
	CatalogShared
	// CatalogGateway lists the kind from the Gateway-API informer factory.
	CatalogGateway
	// CatalogAPIExtensions lists the kind from the apiextensions informer factory.
	CatalogAPIExtensions
	// CatalogNone excludes a built-in kind from object-catalog collection. The
	// kind can still participate in other descriptor-driven subsystems.
	CatalogNone
)

// Descriptor is the one place a kind hands the rest of the app everything it needs.
// Facet fields are nil/zero when the kind does not participate in that subsystem
// (e.g. Stream is nil for a kind that is not directly streamed). The catalog,
// resource-stream, snapshot, object-map, detail-binding, and cache-invalidation
// subsystems each read only the facets they care about.
type Descriptor struct {
	// Identity is the kind's canonical group/version/kind/resource. It is the
	// single source of identity; subsystems key informers and listers off it.
	Identity resourcekind.Identity

	// CatalogSource tells the object catalog which informer factory (or the dynamic
	// client) backs this kind's list/watch, or excludes it with CatalogNone.
	CatalogSource CatalogSource

	// DetailCacheable marks kinds whose informer drives response-cache eviction of
	// cached detail/YAML/Helm responses. The factory is implied by the kind's group.
	DetailCacheable bool

	// IngestOwned marks a kind cut over to the owned-reflector ingestion path: its
	// objects are projected at intake by an ingest reflector and the shared informer
	// factory no longer caches it as a typed object. Every subsystem that would
	// otherwise read this kind from the shared informer (the typed-table maintained
	// store, the object catalog, the object map, the response-cache invalidator)
	// instead reads the ingest projections. Adding the next domain to the ingest path
	// is flipping this facet on its kinds — the consumers are already generic over it.
	IngestOwned bool

	// Stream is the directly-streamed-table descriptor; nil when the kind is not
	// streamed via the generic descriptor dispatch (it streams via a bespoke path
	// or not at all).
	Stream *streamspec.Descriptor

	// Collector projects this kind into the object map from the shared informer
	// cache; nil when the kind has no shared-informer object-map node.
	Collector *objectmapnode.Collector

	// GatewayCollector projects a Gateway-API kind into the object map via the
	// Gateway client; nil for non-Gateway kinds.
	GatewayCollector *objectmapnode.GatewayCollector

	// Edges builds this kind's object-map relationship edges; nil when the kind
	// contributes no edges.
	Edges func(clusterID string, obj metav1.Object) []objectmapspec.Edge

	// Binding is the typed detail-service / app-binding spec; nil when the kind's
	// detail is served by a bespoke path (e.g. Pod, CustomResourceDefinition, Helm).
	Binding *appbinding.Spec

	// Graph is the kind's role in the object-map graph traversal (zero value for
	// kinds with no special graph behaviour).
	Graph ObjectMapGraph

	// Workload is the kind's mutating workload actions (restart/scale); nil for
	// non-workload kinds.
	Workload *WorkloadOperations

	// PortForward describes this kind as a port-forward target (how to resolve it to
	// a backing pod, plus reconnect / service-port-spec behaviour); nil for kinds
	// that cannot be port-forwarded.
	PortForward *PortForwardTarget
}

// PortForwardTarget is a kind's port-forward behaviour, declared in the kind's
// package so the port-forward handlers never switch on kind.
type PortForwardTarget struct {
	// Reconnect reports whether a dropped forward to this kind should auto-reconnect
	// (workloads/services churn pods; a bare Pod does not).
	Reconnect bool
	// UsesServicePortSpec reports whether the requested port is a Service port that
	// must be mapped to the backing pod's container port (true only for Service).
	UsesServicePortSpec bool
	// ResolvePod resolves the target to a ready backing pod name.
	ResolvePod func(ctx context.Context, client kubernetes.Interface, namespace, name string) (string, error)
}
