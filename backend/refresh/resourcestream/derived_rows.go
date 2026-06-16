/*
 * backend/refresh/resourcestream/derived_rows.go
 *
 * Builds derived resource stream rows from canonical Kubernetes objects.
 */

package resourcestream

import (
	"fmt"

	podres "github.com/luxury-yacht/app/backend/resources/pods"

	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	appsv1 "k8s.io/api/apps/v1"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
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
	ref := m.resourceRefForObject(pod, "", "v1", "Pod", "pods")
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
	pods, err := m.podsForNode(node.Name)
	if err != nil {
		m.logWarn(fmt.Sprintf("resource stream: list pods for node %s failed: %v", node.Name, err))
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return
	}

	summary, err := snapshot.BuildNodeSummary(m.clusterMeta, node, pods, m.nodeMetricsSnapshot(), m.podMetricsSnapshot())
	if err != nil {
		m.logWarn(fmt.Sprintf("resource stream: build node summary for %s failed: %v", node.Name, err))
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return
	}

	ref := m.resourceRefForObject(node, "", "v1", "Node", "nodes")
	update := m.newObjectRowUpdate(updateType, domainNodes, node, ref, summary)

	m.broadcast(domainNodes, []string{""}, update)
}

func (m *Manager) handleWorkload(obj interface{}, updateType MessageType) {
	workload, kind := workloadFromObject(obj)
	if workload == nil {
		return
	}

	namespace := workload.GetNamespace()
	ownerKey := snapshot.WorkloadOwnerKey(kind, namespace, workload.GetName())
	pods, err := m.podsForWorkload(namespace, ownerKey)
	if err != nil {
		m.logWarn(fmt.Sprintf("resource stream: list pods for workload %s failed: %v", ownerKey, err))
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return
	}

	podUsage := m.podMetricsSnapshot()
	hpas := m.hpasForWorkloadContext(namespace, nil, updateType)
	summary, err := snapshot.BuildWorkloadSummary(m.clusterMeta, workload, pods, podUsage, hpas...)
	if err != nil {
		m.logWarn(fmt.Sprintf("resource stream: build workload summary for %s failed: %v", ownerKey, err))
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return
	}

	ref := m.workloadRef(workload, kind)
	update := m.newObjectRowUpdate(updateType, domainWorkloads, workload, ref, summary)

	m.broadcast(domainWorkloads, scopesForNamespace(namespace), update)
}

func (m *Manager) workloadRef(workload metav1.Object, kind string) resourcemodel.ResourceRef {
	switch workload.(type) {
	case *appsv1.Deployment:
		return m.resourceRefForObject(workload, "apps", "v1", "Deployment", "deployments")
	case *appsv1.StatefulSet:
		return m.resourceRefForObject(workload, "apps", "v1", "StatefulSet", "statefulsets")
	case *appsv1.DaemonSet:
		return m.resourceRefForObject(workload, "apps", "v1", "DaemonSet", "daemonsets")
	case *batchv1.Job:
		return m.resourceRefForObject(workload, "batch", "v1", "Job", "jobs")
	case *batchv1.CronJob:
		return m.resourceRefForObject(workload, "batch", "v1", "CronJob", "cronjobs")
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

	pods, err := m.podsForWorkload(namespace, ownerKey)
	if err != nil {
		m.logWarn(fmt.Sprintf("resource stream: list pods for workload %s failed: %v", ownerKey, err))
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return
	}

	hpas := m.hpasForWorkloadContext(namespace, nil, updateType)
	summary, err := snapshot.BuildWorkloadSummary(m.clusterMeta, workload, pods, usage, hpas...)
	if err != nil {
		m.logWarn(fmt.Sprintf("resource stream: build workload summary for %s failed: %v", ownerKey, err))
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return
	}

	ref := m.workloadRef(workload, kind)
	update := m.newObjectRowUpdate(MessageTypeModified, domainWorkloads, workload, ref, summary)
	update.ResourceVersion = pod.ResourceVersion
	m.broadcast(domainWorkloads, scopesForNamespace(namespace), update)
}

func (m *Manager) broadcastWorkloadRow(kind, namespace, name, resourceVersion string, hpas []*autoscalingv1.HorizontalPodAutoscaler) {
	workload, err := m.lookupWorkload(kind, namespace, name)
	if err != nil || workload == nil {
		return
	}
	ownerKey := snapshot.WorkloadOwnerKey(kind, namespace, name)
	pods, err := m.podsForWorkload(namespace, ownerKey)
	if err != nil {
		m.logWarn(fmt.Sprintf("resource stream: list pods for workload %s failed: %v", ownerKey, err))
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return
	}
	summary, err := snapshot.BuildWorkloadSummary(m.clusterMeta, workload, pods, m.podMetricsSnapshot(), hpas...)
	if err != nil {
		m.logWarn(fmt.Sprintf("resource stream: build workload summary for %s failed: %v", ownerKey, err))
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return
	}
	ref := m.workloadRef(workload, kind)
	update := m.newObjectRowUpdate(MessageTypeModified, domainWorkloads, workload, ref, summary)
	update.ResourceVersion = resourceVersion
	m.broadcast(domainWorkloads, scopesForNamespace(namespace), update)
}

func (m *Manager) broadcastStandalonePodWorkloadRow(namespace, name, resourceVersion string, hpas []*autoscalingv1.HorizontalPodAutoscaler) {
	if m.podLister == nil {
		return
	}
	pod, err := m.podLister.Pods(namespace).Get(name)
	if err != nil || pod == nil {
		return
	}
	summary := snapshot.BuildStandalonePodWorkloadSummary(m.clusterMeta, pod, m.podMetricsSnapshot(), hpas...)
	ref := m.resourceRefForObject(pod, "", "v1", "Pod", "pods")
	update := m.newObjectRowUpdate(MessageTypeModified, domainWorkloads, pod, ref, summary)
	update.ResourceVersion = resourceVersion
	m.broadcast(domainWorkloads, scopesForNamespace(namespace), update)
}

func (m *Manager) handleStandalonePodWorkload(pod *corev1.Pod, updateType MessageType, usage map[string]metrics.PodUsage) {
	if pod == nil {
		return
	}
	if pod.Status.Phase == corev1.PodSucceeded || pod.Status.Phase == corev1.PodFailed {
		updateType = MessageTypeDeleted
	}

	hpas := m.hpasForWorkloadContext(pod.Namespace, nil, updateType)
	summary := snapshot.BuildStandalonePodWorkloadSummary(m.clusterMeta, pod, usage, hpas...)
	ref := m.resourceRefForObject(pod, "", "v1", "Pod", "pods")
	update := m.newObjectRowUpdate(updateType, domainWorkloads, pod, ref, summary)

	m.broadcast(domainWorkloads, scopesForNamespace(pod.Namespace), update)
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

	pods, err := m.podsForNode(node.Name)
	if err != nil {
		m.logWarn(fmt.Sprintf("resource stream: list pods for node %s failed: %v", node.Name, err))
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return
	}
	summary, err := snapshot.BuildNodeSummary(m.clusterMeta, node, pods, m.nodeMetricsSnapshot(), m.podMetricsSnapshot())
	if err != nil {
		m.logWarn(fmt.Sprintf("resource stream: build node summary for %s failed: %v", node.Name, err))
		if m.telemetry != nil {
			m.telemetry.RecordStreamError(telemetry.StreamResources, err)
		}
		return
	}

	ref := m.resourceRefForObject(node, "", "v1", "Node", "nodes")
	update := m.newObjectRowUpdate(MessageTypeModified, domainNodes, node, ref, summary)
	m.broadcast(domainNodes, []string{""}, update)
}

// podStreamRow resolves a pod's current usage and builds its row via the pods
// package (which cannot import refresh/metrics — it would cycle through
// resourcecontract — so the manager owns the usage lookup).
func podStreamRow(m *Manager, pod *corev1.Pod, podUsage map[string]metrics.PodUsage) snapshot.PodSummary {
	usage := podUsage[pod.Namespace+"/"+pod.Name]
	return podres.BuildStreamSummary(m.clusterMeta, pod, usage.CPUUsageMilli, usage.MemoryUsageBytes, m.rsLister)
}
