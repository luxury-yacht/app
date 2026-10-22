// Package objectmapnode is the leaf that lets each kind declare how the object map
// projects it: each object's graph-node status (and optional action facts). The
// owned ingest reflectors project these at intake; the collector loop in snapshot
// reads the projected nodes and never names a kind.
package objectmapnode

import (
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	"github.com/luxury-yacht/app/backend/resourcekind"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Collector is one kind's object-map collection declaration.
type Collector struct {
	Identity resourcekind.Identity
	// Status projects an object into its graph-node status.
	Status func(clusterID string, obj metav1.Object) *objectmap.Status
	// ActionFacts projects an object into its node action facts; nil when the kind
	// contributes none.
	ActionFacts func(obj metav1.Object) *objectmap.ActionFacts
}
