/*
 * backend/refresh/streamspec/descriptor.go
 *
 * The per-kind stream Descriptor: everything resource-stream needs to register a
 * kind's informer and project its events into rows, with no per-kind code in the
 * stream manager. Each kind owns its Descriptor (in resources/<kind>/streamdescriptor.go)
 * and a registry aggregates them; the manager loops the registry and never names a kind.
 *
 * This package imports only leaves (streamrows + client-go informer/cache + metav1)
 * and NO kind packages, so kinds can declare a Descriptor without an import cycle.
 */

package streamspec

import (
	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
)

// Descriptor is the registry entry for one directly-streamed built-in kind served
// by the shared informer factory.
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

	// Informer returns the kind's informer from the shared factory.
	Informer func(factory informers.SharedInformerFactory) cache.SharedIndexInformer
}
