/*
 * backend/refresh/resourcestream/stream_descriptor_dispatch.go
 *
 * Generic descriptor-driven stream registration. The manager loops the stream
 * registry and wires each kind's informer to a shared notification handler.
 * The descriptor supplies identity and scope; snapshots own row projection.
 */

package resourcestream

import (
	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/refresh/informer"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/tools/cache"
)

// registerDescriptorStreams wires every registry descriptor to the generic erased
// handler, resolving its informer from whichever factory the descriptor uses
// (shared or Gateway-API). Descriptors whose factory is unavailable are skipped.
func (m *Manager) registerDescriptorStreams(factory *informer.Factory) {
	shared := factory.SharedInformerFactory()
	gatewayShared := factory.GatewayInformerFactory()
	ingestOwned := kindregistry.IngestOwnedGVRs()
	for _, d := range kindregistry.StreamDescriptors() {
		// Kinds with a bespoke streaming handler (HorizontalPodAutoscaler, via
		// registerAutoscalingStreams) are registered there; their descriptor exists
		// only for the snapshot side.
		// IngestOwned (cut) kinds have no typed informer in the factory; their
		// signal-only change signal is driven from the ingest Catalog-half Sink
		// (registerIngestNotifyStreams) so calling d.Informer(shared) here would
		// re-create the very informer the cutover eliminated.
		if _, owned := ingestOwned[d.GVR()]; owned || d.CustomStreamHandler {
			continue
		}
		if !m.canListWatch(d.Group, d.Resource) {
			continue
		}
		var inf cache.SharedIndexInformer
		switch {
		case d.Informer != nil && shared != nil:
			inf = d.Informer(shared)
		case d.GatewayInformer != nil && gatewayShared != nil:
			inf = d.GatewayInformer(gatewayShared)
		}
		if inf == nil {
			continue
		}
		desc := d
		m.addResourceEventHandler(inf, func(mgr *Manager, obj interface{}, updateType MessageType) {
			mgr.broadcastObjectFromDescriptor(obj, updateType, desc)
		})
	}
}

// broadcastObjectFromDescriptor emits object identity and resource version.
// Query-backed tables own row projection; the stream only tells them to refetch.
func (m *Manager) broadcastObjectFromDescriptor(obj interface{}, updateType MessageType, d streamspec.Descriptor) {
	item, ok := objectAs[metav1.Object](obj)
	if !ok {
		return
	}
	ref := m.resourceRefForObject(item, d.Group, d.Version, d.Kind, d.Resource)
	update := m.newObjectUpdate(updateType, d.Domain, item.GetResourceVersion(), ref)
	scopes := scopesForCluster()
	if !d.ClusterScoped {
		scopes = scopesForNamespace(item.GetNamespace())
	}
	m.broadcast(d.Domain, scopes, update)
}
