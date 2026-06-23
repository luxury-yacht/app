/*
 * backend/kind/streamspec/descriptor.go
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
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
	gatewayinformers "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions"
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

	// CustomStreamHandler marks a kind whose live streaming is wired by a bespoke
	// handler in resourcestream (e.g. ConfigMap/Secret, which also trigger a
	// Helm-release refresh side-effect). registerDescriptorStreams skips these so
	// the custom handler stays the sole streamer; the descriptor still exists so
	// the snapshot side (kindregistry.StreamDescriptorsForDomain) and the drift guard see the kind.
	CustomStreamHandler bool

	// StreamRow projects one event object into its neutral stream row. The closure
	// lives in the kind package and does the concrete type assertion, so the
	// manager handles only metav1.Object.
	StreamRow func(meta streamrows.ClusterMeta, obj metav1.Object) any

	// Informer returns the kind's informer from the shared factory. Kinds served by
	// the shared factory set this; Gateway-API kinds set GatewayInformer instead.
	Informer func(factory informers.SharedInformerFactory) cache.SharedIndexInformer

	// GatewayInformer returns the kind's informer from the Gateway-API factory.
	GatewayInformer func(factory gatewayinformers.SharedInformerFactory) cache.SharedIndexInformer
}

// GVR returns the descriptor's GroupVersionResource. It is the single source the
// snapshot/ingest wiring uses to key a kind's informer, maintained-store sink, and
// ingest-owned membership, so no caller re-assembles the GVR by hand.
func (d Descriptor) GVR() schema.GroupVersionResource {
	return schema.GroupVersionResource{Group: d.Group, Version: d.Version, Resource: d.Resource}
}
