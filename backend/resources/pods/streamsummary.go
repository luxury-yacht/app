/*
 * backend/resources/pods/streamsummary.go
 *
 * Pod's stream-summary builder, owned by the kind's package. Produces the neutral
 * streamrows.PodSummary row. It takes the pod's already-resolved CPU/memory usage
 * as primitives rather than the metrics map: refresh/metrics transitively imports
 * resourcecontract, which imports every kind package, so a metrics import here
 * would cycle. The caller (snapshot/manager) owns the metrics lookup.
 *
 * BuildStreamSummary resolves the pod's ReplicaSet->Deployment owner map from a
 * lister (the streaming path); BuildStreamSummaryFromRSMap takes a pre-built map
 * (the full-snapshot path builds one map for all pods).
 */

package pods

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/resources/common"
	corev1 "k8s.io/api/core/v1"
	appslisters "k8s.io/client-go/listers/apps/v1"
)

// BuildStreamSummary builds the pod row, resolving the Deployment owner from the
// ReplicaSet lister. cpuUsageMilli/memUsageBytes are the pod's current usage.
func BuildStreamSummary(meta streamrows.ClusterMeta, pod *corev1.Pod, cpuUsageMilli, memUsageBytes int64, rsLister appslisters.ReplicaSetLister) streamrows.PodSummary {
	if pod == nil {
		return streamrows.PodSummary{ClusterMeta: meta}
	}
	return buildPodRow(meta, pod, cpuUsageMilli, memUsageBytes, buildReplicaSetDeploymentMapForPod(pod, rsLister))
}

// BuildStreamSummaryFromRSMap builds the pod row with a pre-built ReplicaSet->
// Deployment owner map (the full-snapshot path shares one map across all pods).
func BuildStreamSummaryFromRSMap(meta streamrows.ClusterMeta, pod *corev1.Pod, cpuUsageMilli, memUsageBytes int64, rsMap map[string]string) streamrows.PodSummary {
	if pod == nil {
		return streamrows.PodSummary{ClusterMeta: meta}
	}
	return buildPodRow(meta, pod, cpuUsageMilli, memUsageBytes, rsMap)
}

func buildPodRow(meta streamrows.ClusterMeta, pod *corev1.Pod, cpuUsageMilli, memUsageBytes int64, rsMap map[string]string) streamrows.PodSummary {
	model := BuildResourceModel(meta.ClusterID, pod)
	podFacts := BuildFacts(pod)
	owner := resolvePodOwner(pod, rsMap)
	cpuReq, cpuLim, memReq, memLim := computeResourceTotals(pod)
	return streamrows.PodSummary{
		ClusterMeta:           meta,
		Name:                  pod.Name,
		Namespace:             pod.Namespace,
		Node:                  pod.Spec.NodeName,
		Status:                model.Status.Label,
		StatusState:           model.Status.State,
		StatusPresentation:    model.Status.Presentation,
		StatusReason:          model.Status.Reason,
		Ready:                 fmt.Sprintf("%d/%d", podFacts.ReadyContainers, podFacts.TotalContainers),
		Restarts:              podFacts.RestartCount,
		Age:                   streamrows.FormatAge(pod.CreationTimestamp.Time),
		AgeTimestamp:          streamrows.CreationMillis(pod),
		OwnerKind:             owner.kind,
		OwnerName:             owner.name,
		PortForwardAvailable:  common.HasForwardableContainerPorts(pod.Spec.Containers),
		OwnerAPIVersion:       owner.apiVersion,
		DirectOwnerKind:       owner.directKind,
		DirectOwnerName:       owner.directName,
		DirectOwnerAPIVersion: owner.directAPIVersion,
		CPURequest:            streamrows.FormatCPUMilli(cpuReq),
		CPULimit:              streamrows.FormatCPUMilli(cpuLim),
		CPUUsage:              streamrows.FormatCPUMilli(cpuUsageMilli),
		MemRequest:            streamrows.FormatMemoryBytes(memReq),
		MemLimit:              streamrows.FormatMemoryBytes(memLim),
		MemUsage:              streamrows.FormatMemoryBytes(memUsageBytes),
	}
}

// podOwner carries both owner identities a pod row stores: the direct
// controlling ownerRef as written on the pod, and the collapsed owner with a
// ReplicaSet resolved to its Deployment (equal to direct for every other kind).
type podOwner struct {
	kind, name, apiVersion                   string
	directKind, directName, directAPIVersion string
}

func resolvePodOwner(pod *corev1.Pod, rsMap map[string]string) podOwner {
	for _, owner := range pod.OwnerReferences {
		if owner.Controller == nil || !*owner.Controller {
			continue
		}
		resolved := podOwner{
			kind:             owner.Kind,
			name:             owner.Name,
			apiVersion:       owner.APIVersion,
			directKind:       owner.Kind,
			directName:       owner.Name,
			directAPIVersion: owner.APIVersion,
		}
		if owner.Kind == "ReplicaSet" {
			if deployment, ok := rsMap[owner.Name]; ok {
				resolved.kind = "Deployment"
				resolved.name = deployment
				resolved.apiVersion = "apps/v1"
			}
		}
		return resolved
	}
	return podOwner{kind: "None", name: "None"}
}

func computeResourceTotals(pod *corev1.Pod) (cpuReq, cpuLim, memReq, memLim int64) {
	if pod == nil {
		return 0, 0, 0, 0
	}
	for _, container := range pod.Spec.Containers {
		if cpu := container.Resources.Requests.Cpu(); cpu != nil {
			cpuReq += cpu.MilliValue()
		}
		if cpu := container.Resources.Limits.Cpu(); cpu != nil {
			cpuLim += cpu.MilliValue()
		}
		if mem := container.Resources.Requests.Memory(); mem != nil {
			memReq += mem.Value()
		}
		if mem := container.Resources.Limits.Memory(); mem != nil {
			memLim += mem.Value()
		}
	}
	return cpuReq, cpuLim, memReq, memLim
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
