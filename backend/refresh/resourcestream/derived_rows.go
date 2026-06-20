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

	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
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
	case MessageTypeAdded:
		newRS := replicaSetFromObject(newObj)
		m.refreshPodsForReplicaSet(newRS, replicaSetStaleWorkloadScopes(nil, newRS))
	case MessageTypeDeleted:
		oldRS := replicaSetFromObject(oldObj)
		m.refreshPodsForReplicaSet(oldRS, replicaSetStaleWorkloadScopes(oldRS, nil))
	case MessageTypeModified:
		oldRS := replicaSetFromObject(oldObj)
		newRS := replicaSetFromObject(newObj)
		staleScopes := replicaSetStaleWorkloadScopes(oldRS, newRS)
		seen := make(map[string]struct{})
		m.refreshPodsForReplicaSetOnce(oldRS, staleScopes, seen)
		m.refreshPodsForReplicaSetOnce(newRS, staleScopes, seen)
	}
}

func (m *Manager) refreshPodsForReplicaSet(rs *appsv1.ReplicaSet, staleScopes []string) {
	m.refreshPodsForReplicaSetOnce(rs, staleScopes, make(map[string]struct{}))
}

func (m *Manager) refreshPodsForReplicaSetOnce(
	rs *appsv1.ReplicaSet,
	staleScopes []string,
	seen map[string]struct{},
) {
	if rs == nil || m.podLister == nil {
		return
	}
	pods, err := m.podLister.Pods(rs.Namespace).List(labels.Everything())
	if err != nil {
		m.logWarn(fmt.Sprintf("resource stream: list pods for replicaset %s/%s failed: %v", rs.Namespace, rs.Name, err))
		return
	}
	podUsage := m.podMetricsSnapshot()
	for _, pod := range pods {
		if !podOwnedByReplicaSet(pod, rs) {
			continue
		}
		key := fmt.Sprintf("%s/%s", pod.Namespace, pod.Name)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		if len(staleScopes) > 0 {
			m.broadcastPodRow(pod, MessageTypeDeleted, staleScopes, podUsage)
		}
		m.broadcastPodRow(pod, MessageTypeModified, nil, podUsage)
	}
}

func (m *Manager) handleNode(obj interface{}, updateType MessageType) {
	node := nodeFromObject(obj)
	if node == nil {
		return
	}
	// nodes is notify-only: emit the change signal and let the query-backed table
	// refetch. The node row is rebuilt by the snapshot/query builder.
	m.broadcastNodeNotification(node, updateType)
}

// broadcastNodeNotification emits a row-less node change notification on the
// cluster scope. nodes is notify-only (see notify_only.go): the query-backed
// table refetches on the bare signal and drift keys off Ref, so no NodeSummary
// is projected.
func (m *Manager) broadcastNodeNotification(node metav1.Object, updateType MessageType) {
	ref := m.resourceRefForObject(node, nodespkg.Identity.Group, nodespkg.Identity.Version, nodespkg.Identity.Kind, nodespkg.Identity.Resource)
	update := m.newObjectRowUpdate(updateType, domainNodes, node, ref, nil)
	m.broadcast(domainNodes, []string{""}, update)
}

func (m *Manager) handleWorkload(obj interface{}, updateType MessageType) {
	workload, kind := workloadFromObject(obj)
	if workload == nil {
		return
	}

	// namespace-workloads is notify-only: emit the change signal (Ref/RV) and let
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

	workload, err := m.lookupWorkload(kind, namespace, name)
	if err != nil || workload == nil {
		m.handleStandalonePodWorkload(pod, updateType, usage)
		return
	}

	// A pod change means its owner workload's row may have changed; notify so the
	// query-backed table refetches. The pod's resourceVersion carries the change.
	m.broadcastWorkloadNotification(workload, m.workloadRef(workload, kind), namespace, pod.ResourceVersion, MessageTypeModified)
}

func (m *Manager) broadcastWorkloadRow(kind, namespace, name, resourceVersion string) {
	workload, err := m.lookupWorkload(kind, namespace, name)
	if err != nil || workload == nil {
		return
	}
	m.broadcastWorkloadNotification(workload, m.workloadRef(workload, kind), namespace, resourceVersion, MessageTypeModified)
}

func (m *Manager) broadcastStandalonePodWorkloadRow(namespace, name, resourceVersion string) {
	if m.podLister == nil {
		return
	}
	pod, err := m.podLister.Pods(namespace).Get(name)
	if err != nil || pod == nil {
		return
	}
	ref := m.resourceRefForObject(pod, podres.Identity.Group, podres.Identity.Version, podres.Identity.Kind, podres.Identity.Resource)
	m.broadcastWorkloadNotification(pod, ref, namespace, resourceVersion, MessageTypeModified)
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
// the namespace scope. namespace-workloads is notify-only (see notify_only.go):
// the query-backed table refetches on the bare signal and drift keys off Ref, so
// no WorkloadSummary is projected. resourceVersion overrides the object's own RV
// when the trigger differs from the workload (a pod or HPA event).
func (m *Manager) broadcastWorkloadNotification(obj metav1.Object, ref resourcemodel.ResourceRef, namespace, resourceVersion string, updateType MessageType) {
	update := m.newObjectRowUpdate(updateType, domainWorkloads, obj, ref, nil)
	if resourceVersion != "" {
		update.ResourceVersion = resourceVersion
	}
	m.broadcast(domainWorkloads, scopesForNamespace(namespace), update)
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
