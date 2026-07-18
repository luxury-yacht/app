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

	ownerSummary := podres.BuildStreamSummary(streamrows.ClusterMeta{}, pod, 0, 0, sources.ReplicaSets, jobOwnerLookupAdapter(sources.JobControllerOwner))
	return projectPodAggregateFromSummary(pod, sources, ownerSummary)
}

func projectPodAggregateFromSummary(pod *corev1.Pod, sources PodOwnerSources, ownerSummary streamrows.PodSummary) streamrows.PodAggregate {
	ownerKey := ""
	if ownerSummary.OwnerKind != "" && ownerSummary.OwnerKind != "None" && ownerSummary.OwnerName != "" && ownerSummary.OwnerName != "None" {
		ownerKey = workloadOwnerKey(ownerSummary.OwnerKind, pod.Namespace, ownerSummary.OwnerName)
	}
	// Jobs are visible workload rows, so their Pods remain attributed to the
	// direct Job for metrics. The resolved CronJob identity on PodSummary is
	// separately available for descendant filtering. ReplicaSets are not visible
	// workload rows and continue to collapse into their Deployment owner.
	if ownerSummary.DirectOwnerKind == "Job" && ownerSummary.DirectOwnerName != "" {
		ownerKey = workloadOwnerKey(ownerSummary.DirectOwnerKind, pod.Namespace, ownerSummary.DirectOwnerName)
	}
	// Legacy typed snapshot helpers have no ReplicaSet source at all. Preserve
	// their established Deployment aggregation fallback; the production ingest
	// projector always supplies a (possibly not-yet-synced) lister and therefore
	// keeps the unresolved ReplicaSet identity until the relationship heal runs.
	if sources.ReplicaSets == nil && ownerSummary.OwnerKind == replicasetpkg.Identity.Kind {
		ownerKey = ownerKeyForPod(pod)
	}
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
	// Regular-container resource sums (overview/nodes/workloads).
	for _, container := range pod.Spec.Containers {
		if cpu := container.Resources.Requests.Cpu(); cpu != nil {
			agg.CPURequestMilli += cpu.MilliValue()
		}
		if cpu := container.Resources.Limits.Cpu(); cpu != nil {
			agg.CPULimitMilli += cpu.MilliValue()
		}
		if mem := container.Resources.Requests.Memory(); mem != nil {
			agg.MemRequestBytes += mem.Value()
		}
		if mem := container.Resources.Limits.Memory(); mem != nil {
			agg.MemLimitBytes += mem.Value()
		}
	}
	// Init-container resource sums, kept separate: overview/nodes add them to the
	// regular sums, while workloads sums regular containers only.
	for _, container := range pod.Spec.InitContainers {
		if cpu := container.Resources.Requests.Cpu(); cpu != nil {
			agg.InitCPURequestMilli += cpu.MilliValue()
		}
		if cpu := container.Resources.Limits.Cpu(); cpu != nil {
			agg.InitCPULimitMilli += cpu.MilliValue()
		}
		if mem := container.Resources.Requests.Memory(); mem != nil {
			agg.InitMemRequestBytes += mem.Value()
		}
		if mem := container.Resources.Limits.Memory(); mem != nil {
			agg.InitMemLimitBytes += mem.Value()
		}
	}

	// Readiness + the BuildFacts restart total (container + init + ephemeral).
	facts := podres.BuildFacts(pod)
	agg.ReadyContainers = facts.ReadyContainers
	agg.TotalContainers = facts.TotalContainers
	agg.RestartCountFacts = facts.RestartCount

	// Container + init restart statuses only (the node/overview-hasRestarts sum,
	// which excludes ephemeral containers).
	for _, status := range pod.Status.ContainerStatuses {
		agg.RestartCountContainersInit += status.RestartCount
	}
	for _, status := range pod.Status.InitContainerStatuses {
		agg.RestartCountContainersInit += status.RestartCount
	}

	return agg
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
		switch owner.Kind {
		case deploymentpkg.Identity.Kind, daemonsetpkg.Identity.Kind, statefulsetpkg.Identity.Kind, jobpkg.Identity.Kind:
			return owner.Kind
		case replicasetpkg.Identity.Kind:
			if rsLister == nil {
				return ""
			}
			rs, err := rsLister.ReplicaSets(pod.Namespace).Get(owner.Name)
			if err != nil {
				return ""
			}
			for _, rsOwner := range rs.OwnerReferences {
				if rsOwner.Controller != nil && *rsOwner.Controller && rsOwner.Kind == deploymentpkg.Identity.Kind {
					return deploymentpkg.Identity.Kind
				}
			}
		}
		return ""
	}
	return ""
}
