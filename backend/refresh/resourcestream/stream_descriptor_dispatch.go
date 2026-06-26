/*
 * backend/refresh/resourcestream/stream_descriptor_dispatch.go
 *
 * Generic descriptor-driven stream registration. The manager loops the stream
 * registry and wires each kind's informer to a single erased handler, so no kind
 * is named here. This replaces the per-kind handle* funcs + sharedStreamRegistrations
 * rows as kinds are migrated to streamspec.Descriptor.
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
		if d.CustomStreamHandler {
			continue
		}
		// IngestOwned (cut) kinds have no typed informer in the factory; their
		// signal-only change signal is driven from the ingest Catalog-half Sink
		// (registerIngestNotifyStreams) so calling d.Informer(shared) here would
		// re-create the very informer the cutover eliminated.
		if _, owned := ingestOwned[d.GVR()]; owned {
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
			mgr.streamObjectRowFromDescriptor(obj, updateType, desc)
		})
	}
}

// streamObjectRowFromDescriptor is the erased twin of streamObjectRow: it decodes
// the event to metav1.Object, projects the row via the descriptor's StreamRow
// closure (which does the concrete type assertion), and broadcasts. Behaviour is
// identical to a per-kind streamObjectRow call.
func (m *Manager) streamObjectRowFromDescriptor(obj interface{}, updateType MessageType, d streamspec.Descriptor) {
	item, ok := objectAs[metav1.Object](obj)
	if !ok {
		return
	}
	ref := m.resourceRefForObject(item, d.Group, d.Version, d.Kind, d.Resource)
	row := d.StreamRow(m.clusterMeta, item)
	update := m.newObjectRowUpdate(updateType, d.Domain, item, ref, row)
	scopes := scopesForCluster()
	if !d.ClusterScoped {
		scopes = scopesForNamespace(item.GetNamespace())
	}
	m.broadcast(d.Domain, scopes, update)
}
