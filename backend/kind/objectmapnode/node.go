package objectmapnode

import (
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	"github.com/luxury-yacht/app/backend/kind/objectmapspec"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Node is the object-map projection of one ingest-owned object: everything the
// snapshot object-map index needs to build a graph record WITHOUT retaining the
// source object. An ingest-owned kind's source object is dropped at intake, so the
// fields the object-map later reads off the object — its identity, owner refs,
// labels, creation timestamp, status, action facts, and relationship edges — are
// all extracted here, from the object's OWN fields, at intake.
//
// Edges are the kind's already-resolved ObjectMapEdges output (selector/owner/ref
// descriptors). The snapshot resolver still resolves each Edge's target against the
// full record set later; only the per-source projection moves to intake.
//
// This struct lives in this leaf so both the ingest package (which produces it from
// a descriptor's collector + edges) and the snapshot package (which consumes it into
// a graph record) can share it without an import cycle.
type Node struct {
	// Namespace/Name/UID identify the object; the snapshot builds the graph ref from
	// these plus the kind's Identity (group/version/kind/resource).
	Namespace string
	Name      string
	UID       string
	// CreationTimestamp is the RFC3339 creation time the object-map node displays.
	CreationTimestamp string
	// Owners and Labels are the object's metadata the object-map reads for owner-edge
	// resolution and selector matching of OTHER kinds that target this object.
	Owners []metav1.OwnerReference
	Labels map[string]string
	// Status and ActionFacts are the kind's graph-node projections (collector output).
	Status      *objectmap.Status
	ActionFacts *objectmap.ActionFacts
	// Edges is the kind's relationship edges, pre-resolved from the source object's
	// own fields at intake (the descriptor's ObjectMapEdges output).
	Edges []objectmapspec.Edge
}

// NodeProjector projects one ingest-decoded object into its object-map Node. It is
// built from a kind's descriptor (its collector's Status/ActionFacts plus its
// ObjectMapEdges) so the ingest manager can produce the object-map half of an
// ingest-owned kind's bundle at intake, with no per-kind code in ingest.
type NodeProjector func(clusterID string, obj metav1.Object) Node

// NewNodeProjector builds a NodeProjector from a kind's collector and edge builder.
// status/actionFacts come from the kind's objectmapnode.Collector; edges from the
// kind's ObjectMapEdges. Any of the three funcs may be nil (the kind contributes no
// status, no action facts, or no edges), mirroring the descriptor's optional facets.
func NewNodeProjector(
	status func(clusterID string, obj metav1.Object) *objectmap.Status,
	actionFacts func(obj metav1.Object) *objectmap.ActionFacts,
	edges func(clusterID string, obj metav1.Object) []objectmapspec.Edge,
) NodeProjector {
	return func(clusterID string, obj metav1.Object) Node {
		node := Node{
			Namespace:         obj.GetNamespace(),
			Name:              obj.GetName(),
			UID:               string(obj.GetUID()),
			CreationTimestamp: creationTimestamp(obj),
			Owners:            obj.GetOwnerReferences(),
			Labels:            obj.GetLabels(),
		}
		if status != nil {
			node.Status = status(clusterID, obj)
		}
		if actionFacts != nil {
			node.ActionFacts = actionFacts(obj)
		}
		if edges != nil {
			node.Edges = edges(clusterID, obj)
		}
		return node
	}
}

// creationTimestamp renders an object's creation time as RFC3339 in UTC, matching
// the object-map's objectCreationTimestamp, or "" when unset.
func creationTimestamp(obj metav1.Object) string {
	created := obj.GetCreationTimestamp()
	if created.IsZero() {
		return ""
	}
	return created.UTC().Format(rfc3339)
}

// rfc3339 is time.RFC3339; declared here so this leaf needs no time import beyond
// the format string the object-map uses for node creation timestamps.
const rfc3339 = "2006-01-02T15:04:05Z07:00"
