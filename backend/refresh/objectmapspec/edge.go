// Package objectmapspec is the leaf that lets each kind declare its object-map
// relationship edges without importing the snapshot package. A kind's
// ObjectMapEdges returns Edges; the snapshot edge resolver looks up each Edge's
// relationship metadata and resolves its target descriptor to graph node(s). This
// keeps a kind's relationship logic in the kind's own package.
package objectmapspec

import (
	"github.com/luxury-yacht/app/backend/resourcemodel"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Edge type identifiers. These are the single source for both the kind edge
// declarations and the snapshot relationship table keys.
const (
	EdgeOwner         = "owner"
	EdgeSelector      = "selector"
	EdgeEndpoint      = "endpoint"
	EdgeRoutes        = "routes"
	EdgeScales        = "scales"
	EdgeGrants        = "grants"
	EdgeBinds         = "binds"
	EdgeAggregates    = "aggregates"
	EdgeUses          = "uses"
	EdgeMounts        = "mounts"
	EdgeSchedules     = "schedules"
	EdgeVolumeBinding = "volume-binding"
	EdgeStorageClass  = "storage-class"
)

// CoreRef identifies a graph node by group-less GVK + namespace + name (the
// snapshot resolver looks it up by identity). Namespace is empty for cluster-
// scoped targets (e.g. a PersistentVolume).
type CoreRef struct {
	Version   string
	Kind      string
	Namespace string
	Name      string
}

// Edge is one relationship from a kind's object to a target. Exactly one target
// descriptor is set; the snapshot resolver picks the matching branch and falls
// back to Link when none of the richer descriptors is set. Label and TracedBy are
// optional overrides; when empty the resolver uses the edge type's defaults.
type Edge struct {
	Type     string
	Label    string
	TracedBy string

	Link                resourcemodel.ResourceLink // default target
	CoreRef             *CoreRef                   // resolved by identity
	StorageClass        string                     // StorageClass by name
	IngressClass        string                     // IngressClass by name
	PodsSelector        map[string]string          // pods matching this selector in the source namespace
	PodsLabelSelector   *metav1.LabelSelector      // pods matching this label selector in the source namespace
	ServiceSlices       bool                       // endpoint slices for this service (source namespace + name)
	CoreObjectRef       *corev1.ObjectReference    // a core object reference (endpoints.targetRef)
	ClusterRoleSelector *metav1.LabelSelector      // cluster roles matching this selector
}

// RouteEdges is the shared Gateway-API route projection (HTTPRoute/GRPCRoute/
// TLSRoute): a "uses" edge to each parent and a "routes" edge to each backend.
func RouteEdges(facts resourcemodel.RouteCommonFacts) []Edge {
	edges := make([]Edge, 0, len(facts.ParentRefs)+len(facts.Backends))
	for _, parent := range facts.ParentRefs {
		edges = append(edges, Edge{Type: EdgeUses, TracedBy: "spec.parentRefs", Link: parent})
	}
	for _, backend := range facts.Backends {
		edges = append(edges, Edge{Type: EdgeRoutes, TracedBy: "spec.rules.backendRefs", Link: backend})
	}
	return edges
}
