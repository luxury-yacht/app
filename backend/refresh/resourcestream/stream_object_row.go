package resourcestream

import (
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/tools/cache"
)

// objectAs decodes an informer event payload to the requested type, unwrapping
// delete tombstones. It is the generic replacement for the per-kind
// <kind>FromObject decoders.
func objectAs[T any](obj interface{}) (T, bool) {
	if typed, ok := obj.(T); ok {
		return typed, true
	}
	if tombstone, ok := obj.(cache.DeletedFinalStateUnknown); ok {
		return objectAs[T](tombstone.Obj)
	}
	var zero T
	return zero, false
}

// streamObjectRow is the shared body for direct object→row stream handlers: it
// decodes the event, builds the row summary from the supplied builder, and
// broadcasts the update on the given domain/scope. Each kind's handler is a
// one-line call supplying its typed summary builder and identity; the type
// parameters are inferred from that builder.
func streamObjectRow[T metav1.Object, S any](
	m *Manager,
	obj interface{},
	updateType MessageType,
	summary func(snapshot.ClusterMeta, T) S,
	group, version, kind, resource, domain string,
	clusterScoped bool,
) {
	item, ok := objectAs[T](obj)
	if !ok {
		return
	}
	ref := m.resourceRefForObject(item, group, version, kind, resource)
	row := summary(m.clusterMeta, item)
	update := m.newObjectRowUpdate(updateType, domain, item, ref, row)
	scopes := scopesForCluster()
	if !clusterScoped {
		scopes = scopesForNamespace(item.GetNamespace())
	}
	m.broadcast(domain, scopes, update)
}
