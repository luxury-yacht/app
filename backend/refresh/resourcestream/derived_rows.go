/*
 * backend/refresh/resourcestream/derived_rows.go
 *
 * Builds derived resource stream rows from canonical Kubernetes objects.
 */

package resourcestream

import (
	"fmt"

	cronjobpkg "github.com/luxury-yacht/app/backend/resources/cronjob"
	daemonsetpkg "github.com/luxury-yacht/app/backend/resources/daemonset"
	deploymentpkg "github.com/luxury-yacht/app/backend/resources/deployment"
	jobpkg "github.com/luxury-yacht/app/backend/resources/job"
	nodespkg "github.com/luxury-yacht/app/backend/resources/nodes"
	statefulsetpkg "github.com/luxury-yacht/app/backend/resources/statefulset"

	podres "github.com/luxury-yacht/app/backend/resources/pods"

	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func (m *Manager) handlePod(obj interface{}, updateType MessageType) {
	pod := podFromObject(obj)
	if pod == nil {
		return
	}

	podUsage := m.podMetricsSnapshot()
	m.broadcastPodRow(pod, updateType, nil, podUsage)

	m.handleWorkloadFromPod(pod, updateType, podUsage)
	m.handleNodeFromPod(pod)
}

func (m *Manager) broadcastPodRow(
	pod *corev1.Pod,
	updateType MessageType,
	scopes []string,
	podUsage map[string]metrics.PodUsage,
) {
	if pod == nil {
		return
	}
	summary := podStreamRow(m, pod, podUsage)
	ref := m.resourceRefForObject(pod, podres.Identity.Group, podres.Identity.Version, podres.Identity.Kind, podres.Identity.Resource)
	update := m.newObjectRowUpdate(updateType, domainPods, pod, ref, summary)
	if len(scopes) == 0 {
		scopes = scopesForPod(summary)
	}

	m.broadcast(domainPods, scopes, update)
}

func (m *Manager) handlePodEvent(oldObj interface{}, newObj interface{}, updateType MessageType) {
	switch updateType {
	case MessageTypeAdded:
		m.handlePod(newObj, updateType)
	case MessageTypeDeleted:
		m.handlePod(oldObj, updateType)
	case MessageTypeModified:
		m.handlePod(newObj, updateType)
		oldPod := podFromObject(oldObj)
		newPod := podFromObject(newObj)
		if oldPod == nil || newPod == nil {
			return
		}
		podUsage := m.podMetricsSnapshot()
		oldSummary := podStreamRow(m, oldPod, podUsage)
		newSummary := podStreamRow(m, newPod, podUsage)
		if staleScopes := stalePodScopes(oldSummary, newSummary); len(staleScopes) > 0 {
			m.broadcastPodRow(oldPod, MessageTypeDeleted, staleScopes, podUsage)
		}
		if snapshot.WorkloadOwnerKeyForPod(oldPod) != snapshot.WorkloadOwnerKeyForPod(newPod) {
			m.handleWorkloadFromPod(oldPod, MessageTypeModified, podUsage)
		}
		if oldPod.Spec.NodeName != "" && oldPod.Spec.NodeName != newPod.Spec.NodeName {
			m.handleNodeFromPod(oldPod)
		}
	}
}

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

// broadcastNodeNotification emits a row-less node change notification on the
// cluster scope. The query-backed table refetches on the bare signal and drift
// keys off Ref, so no NodeSummary is projected.
func (m *Manager) broadcastNodeNotification(node metav1.Object, updateType MessageType) {
	ref := m.resourceRefForObject(node, nodespkg.Identity.Group, nodespkg.Identity.Version, nodespkg.Identity.Kind, nodespkg.Identity.Resource)
	update := m.newObjectRowUpdate(updateType, domainNodes, node, ref, nil)
	m.broadcast(domainNodes, []string{""}, update)
}

// broadcastNodeNotificationRef is the ref-only form of broadcastNodeNotification for the
// ingest notify path, which has no typed node object: the change signal is built directly
// from the Ref + resourceVersion (read from the node's projected catalog half), scoped to the
// cluster. The Update is identical to the typed path's for the same node.
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

func (m *Manager) handleWorkload(obj interface{}, updateType MessageType) {
	workload, kind := workloadFromObject(obj)
	if workload == nil {
		return
	}

	// namespace-workloads emits the change signal (Ref/RV) and lets
	// the query-backed table refetch. The row is rebuilt by the snapshot/query
	// builder, so no per-event WorkloadSummary is projected here.
	m.broadcastWorkloadNotification(workload, m.workloadRef(workload, kind), workload.GetNamespace(), "", updateType)
}

func (m *Manager) workloadRef(workload metav1.Object, kind string) resourcemodel.ResourceRef {
	switch workload.(type) {
	case *appsv1.Deployment:
		return m.resourceRefForObject(workload, deploymentpkg.Identity.Group, deploymentpkg.Identity.Version, deploymentpkg.Identity.Kind, deploymentpkg.Identity.Resource)
	case *appsv1.StatefulSet:
		return m.resourceRefForObject(workload, statefulsetpkg.Identity.Group, statefulsetpkg.Identity.Version, statefulsetpkg.Identity.Kind, statefulsetpkg.Identity.Resource)
	case *appsv1.DaemonSet:
		return m.resourceRefForObject(workload, daemonsetpkg.Identity.Group, daemonsetpkg.Identity.Version, daemonsetpkg.Identity.Kind, daemonsetpkg.Identity.Resource)
	case *batchv1.Job:
		return m.resourceRefForObject(workload, jobpkg.Identity.Group, jobpkg.Identity.Version, jobpkg.Identity.Kind, jobpkg.Identity.Resource)
	case *batchv1.CronJob:
		return m.resourceRefForObject(workload, cronjobpkg.Identity.Group, cronjobpkg.Identity.Version, cronjobpkg.Identity.Kind, cronjobpkg.Identity.Resource)
	default:
		return m.resourceRefForObject(workload, "", "", kind, "")
	}
}

func (m *Manager) handleWorkloadFromPod(pod *corev1.Pod, updateType MessageType, usage map[string]metrics.PodUsage) {
	if pod == nil {
		return
	}

	ownerKey := snapshot.WorkloadOwnerKeyForPod(pod)
	if ownerKey == "" {
		m.handleStandalonePodWorkload(pod, updateType, usage)
		return
	}

	namespace, kind, name, ok := parseWorkloadOwnerKey(ownerKey)
	if !ok {
		m.handleStandalonePodWorkload(pod, updateType, usage)
		return
	}

	ref, ok := m.lookupWorkloadRef(kind, namespace, name)
	if !ok {
		m.handleStandalonePodWorkload(pod, updateType, usage)
		return
	}

	// A pod change means its owner workload's row may have changed; notify so the
	// query-backed table refetches. The pod's resourceVersion carries the change.
	m.broadcastWorkloadNotificationRef(ref, namespace, pod.ResourceVersion, MessageTypeModified)
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
	// the store is skipped, matching the typed path's Get-error skip.
	_, catalog, ok := m.lookupPodBundle(namespace, name)
	if !ok {
		return
	}
	ref := resourcemodel.NewResourceRef(
		m.clusterMeta.ClusterID,
		podres.Identity.Group, podres.Identity.Version, podres.Identity.Kind, podres.Identity.Resource,
		namespace, name, catalog.UID,
	)
	m.broadcastWorkloadNotificationRef(ref, namespace, resourceVersion, MessageTypeModified)
}

func (m *Manager) handleStandalonePodWorkload(pod *corev1.Pod, updateType MessageType, _ map[string]metrics.PodUsage) {
	if pod == nil {
		return
	}
	if pod.Status.Phase == corev1.PodSucceeded || pod.Status.Phase == corev1.PodFailed {
		updateType = MessageTypeDeleted
	}

	ref := m.resourceRefForObject(pod, podres.Identity.Group, podres.Identity.Version, podres.Identity.Kind, podres.Identity.Resource)
	m.broadcastWorkloadNotification(pod, ref, pod.Namespace, "", updateType)
}

// broadcastWorkloadNotification emits a row-less workload change notification on
// the namespace scope. The query-backed table refetches on the bare signal and
// drift keys off Ref, so no WorkloadSummary is projected. resourceVersion
// overrides the object's own RV when the trigger differs from the workload (a
// pod or HPA event).
func (m *Manager) broadcastWorkloadNotification(obj metav1.Object, ref resourcemodel.ResourceRef, namespace, resourceVersion string, updateType MessageType) {
	update := m.newObjectRowUpdate(updateType, domainWorkloads, obj, ref, nil)
	if resourceVersion != "" {
		update.ResourceVersion = resourceVersion
	}
	m.broadcast(domainWorkloads, scopesForNamespace(namespace), update)
}

// broadcastWorkloadNotificationRef is the ref-only form of broadcastWorkloadNotification
// for the ingest notify path, which has no typed workload object: the change signal is
// built directly from the Ref + resourceVersion (a standalone pod's own row), scoped to
// the namespace. The Update is identical to the typed path's for a standalone pod whose
// own resourceVersion drove the signal.
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
// pod's projected PodSummary (the ingest notify path, which has no typed pod). It mirrors
// handleWorkloadFromPod: a pod with a resolved controlling owner (OwnerKind/OwnerName,
// ReplicaSet already collapsed to its Deployment by the projection) signals that
// workload's row; an owner-less pod signals itself as a standalone workload row. The
// workload Ref is resolved from the ingest catalog half (those kinds are cut too).
// resourceVersion is the pod's, so the query-backed workloads table refetches.
func (m *Manager) broadcastWorkloadFromPodSummary(summary snapshot.PodSummary, resourceVersion string, updateType MessageType) {
	if summary.OwnerKind != "" && summary.OwnerKind != "None" && summary.OwnerName != "" && summary.OwnerName != "None" {
		if ref, ok := m.lookupWorkloadRef(summary.OwnerKind, summary.Namespace, summary.OwnerName); ok {
			m.broadcastWorkloadNotificationRef(ref, summary.Namespace, resourceVersion, MessageTypeModified)
			return
		}
	}
	m.broadcastStandalonePodWorkloadFromSummary(summary, updateType)
}

// broadcastStandalonePodWorkloadFromSummary signals a standalone pod's own workload row
// from its PodSummary, mirroring handleStandalonePodWorkload: a Succeeded/Failed pod
// (terminal status presentation) is a DELETED row, otherwise the supplied update type.
func (m *Manager) broadcastStandalonePodWorkloadFromSummary(summary snapshot.PodSummary, updateType MessageType) {
	if podSummaryTerminal(summary) {
		updateType = MessageTypeDeleted
	}
	ref := resourcemodel.NewResourceRef(
		m.clusterMeta.ClusterID,
		podres.Identity.Group, podres.Identity.Version, podres.Identity.Kind, podres.Identity.Resource,
		summary.Namespace, summary.Name, "",
	)
	m.broadcastWorkloadNotificationRef(ref, summary.Namespace, "", updateType)
}

// podSummaryTerminal reports whether a pod's projected status presentation marks it as a
// completed (Succeeded) or failed pod — the standalone-workload DELETED condition. The
// resource model presents PodSucceeded/PodFailed as the "completed"/"error" states; the
// stream's standalone path keyed off PodSucceeded/PodFailed phase, which the resource
// model's "completed"/"failed" status labels reflect for a standalone pod.
func podSummaryTerminal(summary snapshot.PodSummary) bool {
	return summary.StatusState == string(corev1.PodSucceeded) || summary.StatusState == string(corev1.PodFailed)
}

// broadcastNodeFromPodNode re-derives the node change signal from a pod's node name (the
// ingest notify path). It mirrors handleNodeFromPod: the node row may have changed, so
// notify the query-backed nodes table to refetch. The node's identity Ref is resolved from
// the ingest node store (the node kind is cut — no typed lister); a node not in the store is
// skipped (it may have been removed), matching the typed path's Get-error skip.
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

func (m *Manager) handleNodeFromPod(pod *corev1.Pod) {
	if pod == nil || pod.Spec.NodeName == "" {
		return
	}
	if m.nodeLister == nil {
		return
	}

	node, err := m.nodeLister.Get(pod.Spec.NodeName)
	if err != nil || node == nil {
		if err != nil {
			m.logWarn(fmt.Sprintf("resource stream: resolve node %s failed: %v", pod.Spec.NodeName, err))
			if m.telemetry != nil {
				m.telemetry.RecordStreamError(telemetry.StreamResources, err)
			}
		}
		return
	}

	// A pod change affects its node's row; notify so the query-backed table refetches.
	m.broadcastNodeNotification(node, MessageTypeModified)
}

// podStreamRow resolves a pod's current usage and builds its row via the pods
// package (which cannot import refresh/metrics — it would cycle through
// resourcecontract — so the manager owns the usage lookup).
func podStreamRow(m *Manager, pod *corev1.Pod, podUsage map[string]metrics.PodUsage) snapshot.PodSummary {
	usage := podUsage[pod.Namespace+"/"+pod.Name]
	return podres.BuildStreamSummary(m.clusterMeta, pod, usage.CPUUsageMilli, usage.MemoryUsageBytes, m.rsLister)
}
