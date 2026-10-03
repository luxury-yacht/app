// backend/refresh/snapshot/pod_aggregate.go
//
// projectPodAggregate reduces a typed Pod to the small streamrows.PodAggregate
// row that the cluster-overview, namespace-workloads, and node domains consume.
// It is the SINGLE place those domains' pod aggregation reads raw Pod spec/status
// fields, so a later ingest step can feed PodAggregate rows from a reflector
// without those domains ever touching a typed Pod.
//
// Every aggregate here reproduces the exact math the three domains used inline
// before this projector existed (see the per-field comments), so the re-pointed
// domains stay byte-equivalent.
package snapshot

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	daemonsetpkg "github.com/luxury-yacht/app/backend/resources/daemonset"
	deploymentpkg "github.com/luxury-yacht/app/backend/resources/deployment"
	jobpkg "github.com/luxury-yacht/app/backend/resources/job"
	podres "github.com/luxury-yacht/app/backend/resources/pods"
	replicasetpkg "github.com/luxury-yacht/app/backend/resources/replicaset"
	statefulsetpkg "github.com/luxury-yacht/app/backend/resources/statefulset"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	appslisters "k8s.io/client-go/listers/apps/v1"
)

// PodOwnerSources are the related-object lookups needed to resolve a Pod's
// controller ancestry without retaining typed Pods in the ingest store.
type PodOwnerSources struct {
	ReplicaSets        appslisters.ReplicaSetLister
	JobControllerOwner func(namespace, jobName string) (JobControllerOwner, bool)
}

// projectPodAggregate computes the per-pod aggregation row from a typed Pod.
// A nil pod yields the zero PodAggregate (matching the nil-skip guards the
// callers already apply before aggregating). The owner sources resolve
// controller ancestry through actual owner references. A nil ReplicaSet source
// leaves a ReplicaSet-owned Pod's WorkloadKind empty, matching the overview
// metrics-bucketing behavior when that relationship source is unavailable.
func projectPodAggregate(pod *corev1.Pod, sources PodOwnerSources) streamrows.PodAggregate {
	if pod == nil {
		return streamrows.PodAggregate{}
	}

	ownerSummary := podres.BuildStreamSummary(streamrows.ClusterMeta{}, pod, sources.ReplicaSets, jobOwnerLookupAdapter(sources.JobControllerOwner))
	return projectPodAggregateFromSummary(pod, sources, ownerSummary)
}

func projectPodAggregateFromSummary(pod *corev1.Pod, sources PodOwnerSources, ownerSummary streamrows.PodSummary) streamrows.PodAggregate {
	ownerKey := podAggregateOwnerKey(pod, sources, ownerSummary)
	agg := streamrows.PodAggregate{
		Namespace:          pod.Namespace,
		Name:               pod.Name,
		NodeName:           pod.Spec.NodeName,
		Phase:              string(pod.Status.Phase),
		ContainerCount:     len(pod.Spec.Containers),
		InitContainerCount: len(pod.Spec.InitContainers),
		// The grouping key attributes metrics to the visible owning workload.
		OwnerKey: ownerKey,
		// WorkloadKind is cluster-overview's metrics-bucketing kind: the controlling
		// owner's kind, with a ReplicaSet resolved to Deployment via the RS lister
		// (the actual RS owner ref), matching clusterOverviewWorkloadKind exactly.
		WorkloadKind: workloadKindForPod(pod, sources.ReplicaSets),
		// Status presentation is derived once from the typed pod (overview reads
		// exactly this string via BuildResourceModel(...).Status.Presentation).
		StatusPresentation: podres.BuildResourceModel("", pod).Status.Presentation,
	}
	agg.CPURequestMilli, agg.CPULimitMilli, agg.MemRequestBytes, agg.MemLimitBytes = sumContainerResources(pod.Spec.Containers)
	agg.InitCPURequestMilli, agg.InitCPULimitMilli, agg.InitMemRequestBytes, agg.InitMemLimitBytes = sumContainerResources(pod.Spec.InitContainers)

	// Readiness + the BuildFacts restart total (container + init + ephemeral).
	facts := podres.BuildFacts(pod)
	agg.ReadyContainers = facts.ReadyContainers
	agg.TotalContainers = facts.TotalContainers
	agg.RestartCountFacts = facts.RestartCount

	// Container + init restart statuses only (the node/overview-hasRestarts sum,
	// which excludes ephemeral containers).
	agg.RestartCountContainersInit = sumContainerRestarts(pod.Status.ContainerStatuses) + sumContainerRestarts(pod.Status.InitContainerStatuses)

	return agg
}

func podAggregateOwnerKey(pod *corev1.Pod, sources PodOwnerSources, summary streamrows.PodSummary) string {
	ownerKey := ""
	if summary.OwnerKind != "" && summary.OwnerKind != "None" && summary.OwnerName != "" && summary.OwnerName != "None" {
		ownerKey = workloadOwnerKey(summary.OwnerKind, pod.Namespace, summary.OwnerName)
	}
	// Jobs are visible workload rows, so their Pods remain attributed to the direct Job.
	if summary.DirectOwnerKind == "Job" && summary.DirectOwnerName != "" {
		ownerKey = workloadOwnerKey(summary.DirectOwnerKind, pod.Namespace, summary.DirectOwnerName)
	}
	// Legacy typed helpers have no ReplicaSet source and retain their owner-ref fallback.
	if sources.ReplicaSets == nil && summary.OwnerKind == replicasetpkg.Identity.Kind {
		ownerKey = ownerKeyForPod(pod)
	}
	return ownerKey
}

func sumContainerResources(containers []corev1.Container) (cpuRequests, cpuLimits, memoryRequests, memoryLimits int64) {
	for _, container := range containers {
		if cpu := container.Resources.Requests.Cpu(); cpu != nil {
			cpuRequests += cpu.MilliValue()
		}
		if cpu := container.Resources.Limits.Cpu(); cpu != nil {
			cpuLimits += cpu.MilliValue()
		}
		if memory := container.Resources.Requests.Memory(); memory != nil {
			memoryRequests += memory.Value()
		}
		if memory := container.Resources.Limits.Memory(); memory != nil {
			memoryLimits += memory.Value()
		}
	}
	return cpuRequests, cpuLimits, memoryRequests, memoryLimits
}

func sumContainerRestarts(statuses []corev1.ContainerStatus) int32 {
	var total int32
	for _, status := range statuses {
		total += status.RestartCount
	}
	return total
}

func jobOwnerLookupAdapter(lookup func(namespace, jobName string) (JobControllerOwner, bool)) podres.JobControllerOwnerLookup {
	if lookup == nil {
		return nil
	}
	return func(namespace, jobName string) (string, string, string, bool) {
		owner, ok := lookup(namespace, jobName)
		if !ok || owner.Controller.Kind == "" || owner.Controller.Name == "" {
			return "", "", "", false
		}
		return schema.GroupVersion{Group: owner.Controller.Group, Version: owner.Controller.Version}.String(), owner.Controller.Kind, owner.Controller.Name, true
	}
}

// workloadKindForPod resolves the cluster-overview metrics-bucketing workload kind
// for a pod: the controlling owner's kind for the four bucketed workload kinds, with
// a ReplicaSet owner resolved to Deployment via the actual ReplicaSet's owner
// reference (read from rsLister). This is the exact resolution
// clusterOverviewWorkloadKind applies through buildClusterOverviewReplicaSetDeploymentMap,
// moved to projection time so the aggregation domains never read the typed pod's
// owner references. Returns "" when there is no controlling owner, the owner is an
// unbucketed kind, or a ReplicaSet owner cannot be resolved to a Deployment.
func workloadKindForPod(pod *corev1.Pod, rsLister appslisters.ReplicaSetLister) string {
	for _, owner := range pod.OwnerReferences {
		if owner.Controller == nil || !*owner.Controller {
			continue
		}
		return workloadKindForControllerOwner(pod.Namespace, owner, rsLister)
	}
	return ""
}

func workloadKindForControllerOwner(namespace string, owner metav1.OwnerReference, rsLister appslisters.ReplicaSetLister) string {
	switch owner.Kind {
	case deploymentpkg.Identity.Kind, daemonsetpkg.Identity.Kind, statefulsetpkg.Identity.Kind, jobpkg.Identity.Kind:
		return owner.Kind
	case replicasetpkg.Identity.Kind:
		return deploymentKindForReplicaSet(namespace, owner.Name, rsLister)
	default:
		return ""
	}
}

func deploymentKindForReplicaSet(namespace, replicaSetName string, rsLister appslisters.ReplicaSetLister) string {
	if rsLister == nil {
		return ""
	}
	replicaSet, err := rsLister.ReplicaSets(namespace).Get(replicaSetName)
	if err != nil {
		return ""
	}
	for _, owner := range replicaSet.OwnerReferences {
		if owner.Controller != nil && *owner.Controller && owner.Kind == deploymentpkg.Identity.Kind {
			return deploymentpkg.Identity.Kind
		}
	}
	return ""
}
