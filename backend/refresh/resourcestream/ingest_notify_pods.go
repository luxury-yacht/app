/*
 * backend/refresh/resourcestream/ingest_notify_pods.go
 *
 * The pod live-stream change signal, sourced from the owned-reflector ingest manager.
 *
 * Pods has no streamspec.Descriptor, so the generic registerIngestNotifyStreams does not
 * cover it; and unlike the signal-only query-backed kinds, the pod stream's broadcast
 * SCOPE depends on the pod's Node and owner (scopesForPod), and a pod change also signals
 * the pod's owner workload and node rows to refetch. The catalog Summary alone (the only
 * half the generic notify reads) lacks Node/owner, so the pod notify reads the WHOLE
 * bundle: the Table half (snapshot.PodSummary) supplies Node/owner for the scopes and the
 * derived workload/node signals; the Catalog half (objectcatalog.Summary) supplies the
 * UID/resourceVersion the change Ref carries. Both halves belong to the same pod (one
 * bundle), so the signal is identical to the typed-pod handler's, with no typed informer.
 */

package resourcestream

import (
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	podres "github.com/luxury-yacht/app/backend/resources/pods"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// podGVR is the pod kind's GVR, the key the pod reflector's store is registered under.
var podGVR = schema.GroupVersionResource{Group: podres.Identity.Group, Version: podres.Identity.Version, Resource: podres.Identity.Resource}

// podBundleSource supplies the cut pod kind's projected bundles for the manager's
// by-key lookups (the HPA->standalone-pod workload signal needs a specific pod's UID/RV
// + namespace/name, which the projected bundle carries) and the owner-heal rewrite
// (healPodsForReplicaSet). *ingest.IngestManager satisfies it.
type podBundleSource interface {
	Rows(gvr schema.GroupVersionResource) []interface{}
	RewriteBundlesByIndex(
		gvr schema.GroupVersionResource,
		indexName string,
		values []string,
		rewrite func(ingest.Bundle) (ingest.Bundle, bool),
	) []ingest.Bundle
}

// lookupPodBundle returns the projected bundle for the pod namespace/name, or false when
// no pod source is wired or the pod is not in the store. It is the ingest replacement for
// a typed podLister.Get used by the by-key notify paths.
func (m *Manager) lookupPodBundle(namespace, name string) (snapshot.PodSummary, objectcatalog.Summary, bool) {
	if m.podIngest == nil {
		return snapshot.PodSummary{}, objectcatalog.Summary{}, false
	}
	for _, raw := range m.podIngest.Rows(podGVR) {
		bundle, ok := raw.(ingest.Bundle)
		if !ok {
			continue
		}
		summary, ok := bundle.Table.(snapshot.PodSummary)
		if !ok || summary.Namespace != namespace || summary.Name != name {
			continue
		}
		catalog, _ := bundle.Catalog.(objectcatalog.Summary)
		return summary, catalog, true
	}
	return snapshot.PodSummary{}, objectcatalog.Summary{}, false
}

// podNotifyBundleSink adapts the pod live-stream notify to an ingest whole-Bundle sink.
// Each UpsertBundle fires a MODIFIED signal (the pod's row may have changed) and each
// DeleteBundle a DELETED signal — the same Add/Update/Delete -> broadcast mapping the
// typed pod handler applied, collapsed to the two events a Sink exposes (equivalent to
// the consumer, which advances sourceVersion on any signal and never reads Update.Type
// for these query-backed domains).
type podNotifyBundleSink struct {
	manager *Manager
}

func (s podNotifyBundleSink) UpsertBundle(bundle ingest.Bundle) {
	s.broadcastBundle(bundle, MessageTypeModified)
}

func (s podNotifyBundleSink) DeleteBundle(bundle ingest.Bundle) {
	s.broadcastBundle(bundle, MessageTypeDeleted)
}

// broadcastBundle emits the pod-row change signal plus the derived owner-workload and
// node change signals, all from the bundle's projected halves. A bundle missing either
// half (a malformed projection) is skipped rather than broadcasting a partial signal.
func (s podNotifyBundleSink) broadcastBundle(bundle ingest.Bundle, updateType MessageType) {
	summary, ok := bundle.Table.(snapshot.PodSummary)
	if !ok {
		return
	}
	catalog, ok := bundle.Catalog.(objectcatalog.Summary)
	if !ok {
		return
	}
	m := s.manager

	// Pod row signal: a Ref (with the catalog half's UID + resourceVersion) on the pod's
	// own scopes (namespace/all-namespaces, node, owner-workload), exactly scopesForPod.
	ref := resourcemodel.NewResourceRef(
		m.clusterMeta.ClusterID,
		podres.Identity.Group, podres.Identity.Version, podres.Identity.Kind, podres.Identity.Resource,
		summary.Namespace, summary.Name, catalog.UID,
	)
	update := Update{
		Type:            updateType,
		Domain:          domainPods,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: catalog.ResourceVersion,
		Ref:             &ref,
	}
	m.broadcast(domainPods, scopesForPod(summary), update)

	// Derived owner-workload signal: a pod change means its owner workload's row may have
	// changed. The PodSummary's resolved owner (OwnerKind/OwnerName, ReplicaSet collapsed
	// to its Deployment) identifies the workload; a standalone pod (no resolved owner)
	// signals itself as a workload row. The carried resourceVersion is the pod's, so the
	// query-backed workloads table refetches on the change.
	m.broadcastWorkloadFromPodSummary(summary, catalog.ResourceVersion, updateType)

	// Derived node signal: a pod change affects its node's row; notify so the
	// query-backed nodes table refetches.
	if summary.Node != "" {
		m.broadcastNodeFromPodNode(summary.Node)
	}
}
