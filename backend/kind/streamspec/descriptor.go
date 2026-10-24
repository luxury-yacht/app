/*
 * backend/kind/streamspec/descriptor.go
 *
 * The per-kind stream Descriptor: everything resource-stream needs to register a
 * kind's reflector and project its events into rows, with no per-kind code in the
 * stream manager. Each kind owns its Descriptor (in resources/<kind>/streamdescriptor.go)
 * and a registry aggregates them; the manager loops the registry and never names a kind.
 *
 * This package imports only leaves (streamrows + apimachinery metav1/schema)
 * and NO kind packages, so kinds can declare a Descriptor without an import cycle.
 */

package streamspec

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// Descriptor is the registry entry for one directly-streamed built-in kind, fed
// by its owned ingest reflector.
type Descriptor struct {
	Group         string
	Version       string
	Kind          string
	Resource      string
	Domain        string
	ClusterScoped bool

	// StreamRow projects one event object into its neutral stream row. The closure
	// lives in the kind package and does the concrete type assertion, so the
	// manager handles only metav1.Object.
	StreamRow func(meta streamrows.ClusterMeta, obj metav1.Object) any

	// AggregateRow projects one object into the compact, kind-owned facts used by
	// cross-object snapshot aggregates. It is retained independently of StreamRow,
	// whose Table half is normally dropped after sink fan-out for ingest-owned kinds.
	AggregateRow func(obj metav1.Object) any
}

// GVR returns the descriptor's GroupVersionResource. It is the single source the
// snapshot/ingest wiring uses to key a kind's reflector, maintained-store sink, and
// ingest-owned membership, so no caller re-assembles the GVR by hand.
func (d Descriptor) GVR() schema.GroupVersionResource {
	return schema.GroupVersionResource{Group: d.Group, Version: d.Version, Resource: d.Resource}
}
