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
	"github.com/luxury-yacht/app/backend/refresh/informer"
	"github.com/luxury-yacht/app/backend/refresh/streamregistry"
	"github.com/luxury-yacht/app/backend/refresh/streamspec"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// registerDescriptorStreams wires every registry descriptor served by the shared
// informer factory to the generic erased handler.
func (m *Manager) registerDescriptorStreams(factory *informer.Factory) {
	shared := factory.SharedInformerFactory()
	if shared == nil {
		return
	}
	for _, d := range streamregistry.Shared {
		if !m.canListWatch(d.Group, d.Resource) {
			continue
		}
		desc := d
		m.addResourceEventHandler(desc.Informer(shared), func(mgr *Manager, obj interface{}, updateType MessageType) {
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
