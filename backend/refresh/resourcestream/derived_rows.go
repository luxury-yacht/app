/*
 * backend/refresh/resourcestream/derived_rows.go
 *
 * Builds derived resource stream rows from canonical Kubernetes objects.
 */

package resourcestream

import (
	podres "github.com/luxury-yacht/app/backend/resources/pods"

	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
)

func (m *Manager) handleReplicaSetEvent(oldObj interface{}, newObj interface{}, updateType MessageType) {
	switch updateType {
	case MessageTypeAdded, MessageTypeModified:
		m.healPodsForReplicaSet(replicaSetFromObject(newObj))
	case MessageTypeDeleted:
		// Nothing to heal: a deleted RS cascades to its pods, whose own delete
		// events clean every scope; an orphaned pod's owner-ref removal arrives
		// as a pod update and re-projects its row.
	}
}

// healPodsForReplicaSet re-resolves stored pod bundles whose ReplicaSet->
// Deployment owner could not be resolved when they were projected. The pod
// projector reads the shared factory's RS lister, but the owned pod reflector
// starts BEFORE the factory (ingest_hub.go), so pods projected in that window
// carry the unresolved ReplicaSet as their collapsed owner — the Deployment's
// workload-scoped pods query then serves nothing and its doorbell never rings,
// and owned reflectors never resync to repair it. Healing on the RS informer's
// events closes the race: the rewrite fans through the store's sinks like a
// reflector update, and the pod notify sink signals every scope the healed row
// belongs to — namespace, node, the NEW Deployment scope, and the ReplicaSet
// scope, which the row still occupies through its direct owner.
func (m *Manager) healPodsForReplicaSet(rs *appsv1.ReplicaSet) {
	if rs == nil || m.podIngest == nil {
		return
	}
	deployment := replicaSetDeploymentOwnerName(rs)
	if deployment == "" {
		// A standalone RS's pods correctly keep the ReplicaSet owner.
		return
	}
	m.podIngest.RewriteBundlesByIndex(
		podGVR,
		snapshot.PodOwnerKeyIndexName,
		snapshot.PodOwnerHealIndexValues(rs.Namespace, rs.Name, deployment),
		func(bundle ingest.Bundle) (ingest.Bundle, bool) {
			return snapshot.HealPodBundleReplicaSetOwner(bundle, rs.Namespace, rs.Name, deployment)
		},
	)
}

// broadcastNodeNotificationRef emits a row-less node change notification on the
// cluster scope for the ingest notify path, which has no typed node object: the
// change signal is built directly from the Ref + resourceVersion (read from the
// node's projected catalog half). The query-backed table refetches on the bare
// signal and drift keys off Ref, so no NodeSummary is projected.
func (m *Manager) broadcastNodeNotificationRef(ref resourcemodel.ResourceRef, resourceVersion string, updateType MessageType) {
	if ref.ClusterID == "" {
		ref.ClusterID = m.clusterMeta.ClusterID
	}
	update := Update{
		Type:            updateType,
		Domain:          domainNodes,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: resourceVersion,
		Ref:             &ref,
	}
	m.broadcast(domainNodes, []string{""}, update)
}

func (m *Manager) broadcastWorkloadRow(kind, namespace, name, resourceVersion string) {
	ref, ok := m.lookupWorkloadRef(kind, namespace, name)
	if !ok {
		return
	}
	m.broadcastWorkloadNotificationRef(ref, namespace, resourceVersion, MessageTypeModified)
}

func (m *Manager) broadcastStandalonePodWorkloadRow(namespace, name, resourceVersion string) {
	// Pods is cut: resolve the targeted pod's identity from the ingest store (the
	// projected catalog half carries its UID) instead of a typed lister. A pod not in
	// the store is skipped (it may have been removed).
	_, catalog, ok := m.lookupPodBundle(namespace, name)
	if !ok {
		return
	}
	ref := resourcemodel.NewResourceRef(
		m.clusterMeta.ClusterID,
		podres.Identity.Group, podres.Identity.Version, podres.Identity.Kind, podres.Identity.Resource,
		namespace, name, catalog.Ref.UID,
	)
	m.broadcastWorkloadNotificationRef(ref, namespace, resourceVersion, MessageTypeModified)
}

// broadcastWorkloadNotificationRef emits a row-less workload change notification on
// the namespace scope. The ingest notify path has no typed workload object: the
// change signal is built directly from the Ref + resourceVersion (a pod's own RV
// when a pod event drove the signal), scoped to the namespace. The query-backed
// table refetches on the bare signal and drift keys off Ref, so no WorkloadSummary
// is projected.
func (m *Manager) broadcastWorkloadNotificationRef(ref resourcemodel.ResourceRef, namespace, resourceVersion string, updateType MessageType) {
	if ref.ClusterID == "" {
		ref.ClusterID = m.clusterMeta.ClusterID
	}
	update := Update{
		Type:            updateType,
		Domain:          domainWorkloads,
		ClusterID:       m.clusterMeta.ClusterID,
		ClusterName:     m.clusterMeta.ClusterName,
		ResourceVersion: resourceVersion,
		Ref:             &ref,
	}
	m.broadcast(domainWorkloads, scopesForNamespace(namespace), update)
}

// broadcastWorkloadFromPodSummary re-derives the owner-workload change signal from a
// pod's projected PodSummary (the ingest notify path, which has no typed pod). A pod
// with a resolved controlling owner (OwnerKind/OwnerName, ReplicaSet already collapsed
// to its Deployment by the projection) signals that workload's row; an owner-less pod
// signals itself as a standalone workload row. The workload Ref is resolved from the
// ingest catalog half (those kinds are cut too). resourceVersion is the pod's, so the
// query-backed workloads table refetches.
func (m *Manager) broadcastWorkloadFromPodSummary(summary snapshot.PodSummary, resourceVersion string, updateType MessageType) {
	if summary.OwnerKind != "" && summary.OwnerKind != "None" && summary.OwnerName != "" && summary.OwnerName != "None" {
		if ref, ok := m.lookupWorkloadRef(summary.OwnerKind, summary.Ref.Namespace, summary.OwnerName); ok {
			m.broadcastWorkloadNotificationRef(ref, summary.Ref.Namespace, resourceVersion, MessageTypeModified)
			return
		}
	}
	m.broadcastStandalonePodWorkloadFromSummary(summary, updateType)
}

// broadcastStandalonePodWorkloadFromSummary signals a standalone pod's own workload row
// from its PodSummary: a Succeeded/Failed pod (terminal status presentation) is a
// DELETED row, otherwise the supplied update type.
func (m *Manager) broadcastStandalonePodWorkloadFromSummary(summary snapshot.PodSummary, updateType MessageType) {
	if podSummaryTerminal(summary) {
		updateType = MessageTypeDeleted
	}
	ref := resourcemodel.NewResourceRef(
		m.clusterMeta.ClusterID,
		podres.Identity.Group, podres.Identity.Version, podres.Identity.Kind, podres.Identity.Resource,
		summary.Ref.Namespace, summary.Ref.Name, "",
	)
	m.broadcastWorkloadNotificationRef(ref, summary.Ref.Namespace, "", updateType)
}

// podSummaryTerminal reports whether a pod's projected status presentation marks it as a
// completed (Succeeded) or failed pod — the standalone-workload DELETED condition. The
// resource model presents PodSucceeded/PodFailed as the "completed"/"error" states, which
// its "completed"/"failed" status labels reflect for a standalone pod.
func podSummaryTerminal(summary snapshot.PodSummary) bool {
	return summary.StatusState == string(corev1.PodSucceeded) || summary.StatusState == string(corev1.PodFailed)
}

// broadcastNodeFromPodNode re-derives the node change signal from a pod's node name (the
// ingest notify path): the node row may have changed, so notify the query-backed nodes
// table to refetch. The node's identity Ref is resolved from the ingest node store (the
// node kind is cut — no typed lister); a node not in the store is skipped (it may have
// been removed).
func (m *Manager) broadcastNodeFromPodNode(nodeName string) {
	if nodeName == "" {
		return
	}
	ref, resourceVersion, ok := m.lookupNodeRef(nodeName)
	if !ok {
		return
	}
	m.broadcastNodeNotificationRef(ref, resourceVersion, MessageTypeModified)
}
