package snapshot

import (
	"context"
	"errors"
	"fmt"

	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	appslisters "k8s.io/client-go/listers/apps/v1"

	"github.com/luxury-yacht/app/backend/refresh/metrics"
)

// BuildPodSummary builds a pod row payload that matches snapshot formatting.
func BuildPodSummary(meta ClusterMeta, pod *corev1.Pod, usage map[string]metrics.PodUsage, rsLister appslisters.ReplicaSetLister) PodSummary {
	if pod == nil {
		return PodSummary{ClusterMeta: meta}
	}
	if usage == nil {
		usage = map[string]metrics.PodUsage{}
	}
	rsMap := buildReplicaSetDeploymentMapForPod(pod, rsLister)
	return buildPodSummary(meta, pod, usage, rsMap)
}

// BuildWorkloadSummary builds a workload row payload for a single workload object.
func BuildWorkloadSummary(meta ClusterMeta, obj interface{}, pods []*corev1.Pod, usage map[string]metrics.PodUsage) (WorkloadSummary, error) {
	podsByOwner := make(map[string][]*corev1.Pod)
	for _, pod := range pods {
		if pod == nil {
			continue
		}
		if ownerKey := ownerKeyForPod(pod); ownerKey != "" {
			podsByOwner[ownerKey] = append(podsByOwner[ownerKey], pod)
		}
	}

	builder := NamespaceWorkloadsBuilder{}
	var summary WorkloadSummary

	switch typed := obj.(type) {
	case *appsv1.Deployment:
		summary = builder.buildDeploymentSummary(typed, podsByOwner, usage)
	case *appsv1.StatefulSet:
		summary = builder.buildStatefulSetSummary(typed, podsByOwner, usage)
	case *appsv1.DaemonSet:
		summary = builder.buildDaemonSetSummary(typed, podsByOwner, usage)
	case *batchv1.Job:
		summary = builder.buildJobSummary(typed, podsByOwner, usage)
	case *batchv1.CronJob:
		summary = builder.buildCronJobSummary(typed, podsByOwner, usage)
	default:
		return WorkloadSummary{}, fmt.Errorf("unsupported workload type %T", obj)
	}

	summary.ClusterMeta = meta
	return summary, nil
}

// BuildStandalonePodWorkloadSummary builds a workload row payload for a standalone pod entry.
func BuildStandalonePodWorkloadSummary(meta ClusterMeta, pod *corev1.Pod, usage map[string]metrics.PodUsage) WorkloadSummary {
	summary := buildStandalonePodSummary(pod, usage)
	summary.ClusterMeta = meta
	return summary
}

// BuildNodeSummary builds a node row payload from the supplied node and pod list.
func BuildNodeSummary(meta ClusterMeta, node *corev1.Node, pods []*corev1.Pod, provider metrics.Provider) (NodeSummary, error) {
	if node == nil {
		return NodeSummary{}, errors.New("node is nil")
	}
	ctx := WithClusterMeta(context.Background(), meta)
	snap := buildNodeSnapshot(ctx, []*corev1.Node{node}, pods, provider)
	if snap == nil {
		return NodeSummary{}, errors.New("node snapshot unavailable")
	}
	payload, ok := snap.Payload.(NodeSnapshot)
	if !ok || len(payload.Nodes) == 0 {
		return NodeSummary{}, errors.New("node summary unavailable")
	}
	return payload.Nodes[0], nil
}

// WorkloadOwnerKey returns the canonical key used for workload pod grouping.
func WorkloadOwnerKey(kind, namespace, name string) string {
	return workloadOwnerKey(kind, namespace, name)
}

// WorkloadOwnerKeyForPod returns the canonical owner key for a pod in workload summaries.
func WorkloadOwnerKeyForPod(pod *corev1.Pod) string {
	return ownerKeyForPod(pod)
}

func buildReplicaSetDeploymentMapForPod(pod *corev1.Pod, rsLister appslisters.ReplicaSetLister) map[string]string {
	result := make(map[string]string)
	if pod == nil || rsLister == nil {
		return result
	}

	for _, owner := range pod.OwnerReferences {
		if owner.Controller == nil || !*owner.Controller || owner.Kind != "ReplicaSet" {
			continue
		}
		rs, err := rsLister.ReplicaSets(pod.Namespace).Get(owner.Name)
		if err != nil {
			continue
		}
		for _, rsOwner := range rs.OwnerReferences {
			if rsOwner.Controller != nil && *rsOwner.Controller && rsOwner.Kind == "Deployment" {
				result[owner.Name] = rsOwner.Name
				break
			}
		}
	}
	return result
}
