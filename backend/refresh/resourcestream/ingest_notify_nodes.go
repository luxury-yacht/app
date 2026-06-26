/*
 * backend/refresh/resourcestream/ingest_notify_nodes.go
 *
 * The node live-stream change signal, sourced from the owned-reflector ingest manager. Nodes
 * has no streamspec.Descriptor (the nodes table is the bespoke NodeSummary whose row joins
 * per-node pod aggregates + metrics), so the generic registerIngestNotifyStreams does not
 * cover it — exactly like pods and the workload/network kinds. The nodes domain is signal-only:
 * handleNode emits only the change signal (Ref + ResourceVersion) on the cluster scope and the
 * query-backed table refetches, so the projected catalog Summary — which carries the
 * kind/identity/name/uid/resourceVersion — is all the signal needs.
 *
 * Two paths read the node ingest store here:
 *   - a Catalog-half notify Sink fires the direct node-change signal (the ingest twin of the
 *     typed handleNode);
 *   - lookupNodeRef resolves a node's identity Ref by name for the pod-derived node signal
 *     (broadcastNodeFromPodNode), reading the catalog half's UID — the ingest replacement for
 *     the typed nodeLister.Get.
 */

package resourcestream

import (
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	nodespkg "github.com/luxury-yacht/app/backend/resources/nodes"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// nodeGVR is the node kind's GVR, the key the node reflector's store is registered under.
var nodeGVR = schema.GroupVersionResource{Group: nodespkg.Identity.Group, Version: nodespkg.Identity.Version, Resource: nodespkg.Identity.Resource}

// nodeBundleSource supplies the cut node kind's projected bundles for lookupNodeRef (the
// pod-derived node signal needs a specific node's UID + name, which the projected bundle's
// Catalog half carries). *ingest.IngestManager satisfies it.
type nodeBundleSource interface {
	Rows(gvr schema.GroupVersionResource) []interface{}
}

// lookupNodeRef resolves the identity Ref of the node by name plus its resourceVersion,
// reading both from the ingest store's projected catalog half (the node kind is cut, so no
// typed lister exists). It reports false when no node source is wired or the node is not in the
// store, matching the typed nodeLister.Get-error skip the callers already applied.
func (m *Manager) lookupNodeRef(name string) (resourcemodel.ResourceRef, string, bool) {
	if m.nodeIngest == nil {
		return resourcemodel.ResourceRef{}, "", false
	}
	for _, raw := range m.nodeIngest.Rows(nodeGVR) {
		bundle, ok := raw.(ingest.Bundle)
		if !ok {
			continue
		}
		catalog, ok := bundle.Catalog.(objectcatalog.Summary)
		if !ok || catalog.Name != name {
			continue
		}
		ref := resourcemodel.NewResourceRef(
			m.clusterMeta.ClusterID,
			nodespkg.Identity.Group, nodespkg.Identity.Version, nodespkg.Identity.Kind, nodespkg.Identity.Resource,
			"", catalog.Name, catalog.UID,
		)
		return ref, catalog.ResourceVersion, true
	}
	return resourcemodel.ResourceRef{}, "", false
}

// registerNodeIngestNotify wires the direct node-change signal to the ingest manager's
// Catalog-half Sink, so no typed informer is created for the notify — the ingest twin of the
// typed handleNode via registerNodeStreams. Each Upsert/Delete broadcasts the same
// Ref/ResourceVersion change signal on the nodes domain that the typed handler did.
// ingestManager may be nil (a unit test), a no-op then.
func (m *Manager) registerNodeIngestNotify(ingestManager *ingest.IngestManager) {
	if m == nil || ingestManager == nil {
		return
	}
	if !m.canListWatch(nodespkg.Identity.Group, nodespkg.Identity.Resource) {
		return
	}
	ingestManager.AddCatalogSink(nodeGVR, nodeNotifyCatalogSink{manager: m})
}

// nodeNotifyCatalogSink adapts the nodes signal-only broadcast to an ingest Catalog-half Sink.
// The reflector delivers the projected catalog Summary (never the source object), which carries
// every identity field the node change signal needs. Upsert fires a MODIFIED signal and Delete
// a DELETED signal — the same Add/Update/Delete -> broadcast mapping the typed handleNode
// applied, collapsed to the two events a Sink exposes (equivalent to the consumer, which
// advances sourceVersion on any signal and never reads Update.Type for this query-backed domain).
type nodeNotifyCatalogSink struct {
	manager *Manager
}

func (s nodeNotifyCatalogSink) Upsert(row interface{}) {
	s.broadcast(row, MessageTypeModified)
}

func (s nodeNotifyCatalogSink) Delete(row interface{}) {
	s.broadcast(row, MessageTypeDeleted)
}

func (s nodeNotifyCatalogSink) broadcast(row interface{}, updateType MessageType) {
	summary, ok := row.(objectcatalog.Summary)
	if !ok {
		return
	}
	ref := resourcemodel.NewResourceRef(
		s.manager.clusterMeta.ClusterID,
		nodespkg.Identity.Group, nodespkg.Identity.Version, nodespkg.Identity.Kind, nodespkg.Identity.Resource,
		"", summary.Name, summary.UID,
	)
	update := Update{
		Type:            updateType,
		Domain:          domainNodes,
		ClusterID:       s.manager.clusterMeta.ClusterID,
		ClusterName:     s.manager.clusterMeta.ClusterName,
		ResourceVersion: summary.ResourceVersion,
		Ref:             &ref,
	}
	s.manager.broadcast(domainNodes, []string{""}, update)
}
