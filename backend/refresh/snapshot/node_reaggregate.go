/*
 * backend/refresh/snapshot/node_reaggregate.go
 *
 * The Node kind's intake/serve split. Node is an owned-reflector ingest kind: the typed
 * node informer is never instantiated, so the node's OWN fields are projected at intake
 * into a NodeSummary (buildNodeOwnSummary, the Table half) and the per-node pod-aggregate
 * join + metrics overlay are re-joined at SERVE (reaggregateNodeSummary).
 *
 * buildNodeOwnSummary produces every field read from the node object alone (status, roles,
 * capacity/allocatable, addresses, kubelet version, labels/annotations, taints). It is the
 * SAME function the projector calls at intake and the typed list-fallback serve loop calls,
 * so both converge on identical own fields. reaggregateNodeSummary overlays the only
 * serve-side additions — the pod request/limit/restart totals, the pod-count, and the node
 * CPU/mem usage — exactly as the pre-cut single-pass loop did,
 * proven byte-identical in node_reaggregate_test.go.
 */

package snapshot

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
	nodepkg "github.com/luxury-yacht/app/backend/resources/nodes"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	"k8s.io/utils/ptr"
)

// buildNodeOwnSummary builds the OWN-fields NodeSummary for one node: every field the
// pre-cut loop set from the node object alone, with the pod-join and metrics fields left
// zero-valued for reaggregateNodeSummary to fill at serve. The metrics-bucketing pod
// aggregation is NOT done here — it is the serve-side re-join.
func buildNodeOwnSummary(meta ClusterMeta, node *corev1.Node) streamrows.NodeSummary {
	model := nodepkg.BuildResourceModel(meta.ClusterID, node)
	summary := streamrows.NodeSummary{
		Ref:                model.Ref,
		Status:             model.Status.Label,
		StatusState:        model.Status.State,
		StatusPresentation: model.Status.Presentation,
		StatusReason:       model.Status.Reason,
		Roles:              formatRoles(extractRoles(node.Labels)),
		Age:                formatAge(node.CreationTimestamp.Time),
		AgeTimestamp:       creationTimestampMillis(node),
		Version:            node.Status.NodeInfo.KubeletVersion,
		Labels:             copyStringMap(node.Labels),
		Annotations:        copyStringMap(node.Annotations),
		Unschedulable:      node.Spec.Unschedulable,
	}

	summary.InternalIP = findNodeAddress(node, corev1.NodeInternalIP)
	summary.ExternalIP = findNodeAddress(node, corev1.NodeExternalIP)

	cpuCapacity := node.Status.Capacity[corev1.ResourceCPU]
	cpuAlloc := node.Status.Allocatable[corev1.ResourceCPU]
	summary.CPUCapacityMilli = cpuCapacity.MilliValue()
	summary.CPUAllocatableMilli = cpuAlloc.MilliValue()

	memCapacity := node.Status.Capacity[corev1.ResourceMemory]
	memAlloc := node.Status.Allocatable[corev1.ResourceMemory]
	summary.MemoryCapacityBytes = memCapacity.Value()
	summary.MemoryAllocatableBytes = memAlloc.Value()

	podsCapacity := node.Status.Capacity[corev1.ResourcePods]
	podsAlloc := node.Status.Allocatable[corev1.ResourcePods]
	summary.PodsCapacity = podsCapacity.String()
	summary.PodsAllocatable = podsAlloc.String()

	summary.Taints = convertTaints(node.Spec.Taints)

	return summary
}

// reaggregateNodeSummary overlays the serve-side pod-aggregate join + metrics overlay onto
// a projected OWN-fields node row, returning the full NodeSummary the pre-cut single-pass
// loop produced. pods are the node's PodAggregate rows (grouped by NodeName by the caller);
// nodeMetrics is the pre-resolved usage map. The only fields written here are the pod
// request/limit/restart totals, the pod-count, and the node CPU/mem usage — every own field
// is left as buildNodeOwnSummary set it.
func reaggregateNodeSummary(
	own streamrows.NodeSummary,
	pods []streamrows.PodAggregate,
	nodeMetrics map[string]metrics.NodeUsage,
) streamrows.NodeSummary {
	summary := own

	cpuReq, cpuLim, memReq, memLim, restarts := aggregatePodResources(pods)
	summary.CPURequestsMilli = cpuReq
	summary.CPULimitsMilli = cpuLim
	summary.MemoryRequestsBytes = memReq
	summary.MemoryLimitsBytes = memLim
	summary.Restarts = restarts

	if capacity := nodePodsCapacityValue(own.PodsCapacity); capacity > 0 {
		summary.Pods = fmt.Sprintf("%d/%d", len(pods), capacity)
	} else {
		summary.Pods = fmt.Sprintf("%d", len(pods))
	}

	// A node with no sample, or a sample that predates the node's creation (a recreated
	// same-name node), carries no usage rather than stale or zero numbers.
	if usage, ok := nodeMetrics[own.Ref.Name]; metricSampleValid(ok, usage.Timestamp, own.AgeTimestamp) {
		summary.CPUUsageMilli = ptr.To(usage.CPUUsageMilli)
		summary.MemoryUsageBytes = ptr.To(usage.MemoryUsageBytes)
	}

	return summary
}

// nodePodsCapacityValue parses the own row's pods-capacity string (a canonical
// resource.Quantity.String()) back to its integer value for the pod-count denominator.
// The round-trip is exact because PodsCapacity was produced by Quantity.String() in
// buildNodeOwnSummary; an unparseable/empty value yields 0, matching the pre-cut path's
// "no capacity" branch (rendered as a bare pod count).
func nodePodsCapacityValue(podsCapacity string) int64 {
	if podsCapacity == "" {
		return 0
	}
	q, err := resource.ParseQuantity(podsCapacity)
	if err != nil {
		return 0
	}
	return q.Value()
}
