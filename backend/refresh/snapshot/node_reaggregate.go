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
 * serve-side additions — the pod request/limit/restart totals, the per-pod usage rows, the
 * pod-count, and the node CPU/mem usage — exactly as the pre-cut single-pass loop did,
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
)

// buildNodeOwnSummary builds the OWN-fields NodeSummary for one node: every field the
// pre-cut loop set from the node object alone, with the pod-join and metrics fields left
// zero-valued for reaggregateNodeSummary to fill at serve. The metrics-bucketing pod
// aggregation is NOT done here — it is the serve-side re-join.
func buildNodeOwnSummary(meta ClusterMeta, node *corev1.Node) streamrows.NodeSummary {
	model := nodepkg.BuildResourceModel(meta.ClusterID, node)
	nodeFacts := nodepkg.BuildFacts(node)
	ageTimestamp := int64(0)
	if !node.CreationTimestamp.Time.IsZero() {
		ageTimestamp = node.CreationTimestamp.Time.UnixMilli()
	}
	summary := streamrows.NodeSummary{
		ClusterMeta:        meta,
		Name:               node.Name,
		Status:             model.Status.Label,
		StatusState:        model.Status.State,
		StatusPresentation: model.Status.Presentation,
		StatusReason:       model.Status.Reason,
		Roles:              formatRoles(extractRoles(node.Labels)),
		Age:                formatAge(node.CreationTimestamp.Time),
		AgeTimestamp:       ageTimestamp,
		Version:            node.Status.NodeInfo.KubeletVersion,
		Labels:             copyStringMap(node.Labels),
		Annotations:        copyStringMap(node.Annotations),
		Kind:               "node",
		Unschedulable:      nodeFacts.Unschedulable,
	}

	if ip := findNodeAddress(node, corev1.NodeInternalIP); ip != "" {
		summary.InternalIP = ip
	}
	if ip := findNodeAddress(node, corev1.NodeExternalIP); ip != "" {
		summary.ExternalIP = ip
	}

	cpuCapacity := node.Status.Capacity[corev1.ResourceCPU]
	cpuAlloc := node.Status.Allocatable[corev1.ResourceCPU]
	summary.CPUCapacity = cpuCapacity.String()
	summary.CPUAllocatable = cpuAlloc.String()
	summary.CPU = cpuCapacity.String()

	memCapacity := node.Status.Capacity[corev1.ResourceMemory]
	memAlloc := node.Status.Allocatable[corev1.ResourceMemory]
	summary.MemoryCapacity = formatMemoryBytes(memCapacity.Value())
	summary.MemoryAllocatable = formatMemoryBytes(memAlloc.Value())
	summary.Memory = formatMemoryBytes(memCapacity.Value())

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
// podMetrics/nodeMetrics are the pre-resolved usage maps. The only fields written here are
// the pod request/limit/restart totals, the per-pod metric rows, the pod-count, and the
// node CPU/mem usage — every own field is left as buildNodeOwnSummary set it.
func reaggregateNodeSummary(
	own streamrows.NodeSummary,
	pods []streamrows.PodAggregate,
	podMetrics map[string]metrics.PodUsage,
	nodeMetrics map[string]metrics.NodeUsage,
) streamrows.NodeSummary {
	summary := own

	cpuReq, cpuLim, memReq, memLim, restarts := aggregatePodResources(pods)
	summary.CPURequests = formatCPUMilli(cpuReq)
	summary.CPULimits = formatCPUMilli(cpuLim)
	summary.MemRequests = formatMemoryBytes(memReq)
	summary.MemLimits = formatMemoryBytes(memLim)
	summary.Restarts = restarts

	if len(pods) > 0 {
		podSummaries := make([]NodePodMetric, 0, len(pods))
		for _, agg := range pods {
			key := fmt.Sprintf("%s/%s", agg.Namespace, agg.Name)
			usage, ok := podMetrics[key]
			// PodAggregate carries no per-pod creationTimestamp, so a per-pod entry can
			// only drop on a MISSING sample (stale-on-recreate is enforced at the node
			// level and in the pods table where the row carries AgeTimestamp). A missing
			// sample renders the no-data marker rather than "0m"/"0Mi".
			cpu, mem := streamrows.MetricsNoData, streamrows.MetricsNoData
			if ok {
				cpu = formatCPUMilli(usage.CPUUsageMilli)
				mem = formatMemoryBytes(usage.MemoryUsageBytes)
			}
			podSummaries = append(podSummaries, NodePodMetric{
				Namespace:   agg.Namespace,
				Name:        agg.Name,
				CPUUsage:    cpu,
				MemoryUsage: mem,
			})
		}
		if len(podSummaries) > 0 {
			summary.PodMetrics = podSummaries
		}
	}
	if capacity := nodePodsCapacityValue(own.PodsCapacity); capacity > 0 {
		summary.Pods = fmt.Sprintf("%d/%d", len(pods), capacity)
	} else {
		summary.Pods = fmt.Sprintf("%d", len(pods))
	}

	// A node with no sample, or a sample that predates the node's creation (a recreated
	// same-name node), renders the no-data marker rather than stale or zero numbers.
	usage, ok := nodeMetrics[own.Name]
	summary.CPUUsage = formatNodeMetricCPU(usage, ok, own.AgeTimestamp)
	summary.MemoryUsage = formatNodeMetricMemory(usage, ok, own.AgeTimestamp)

	return summary
}

// formatNodeMetricCPU and formatNodeMetricMemory render a node (or per-pod) usage
// cell: the formatted number for a valid sample (present, and not predating the
// object's creation — see metricSampleValid), otherwise the no-data marker (never
// "0m"/"0Mi", so "metrics unknown" is distinguishable from a real zero).
func formatNodeMetricCPU(usage metrics.NodeUsage, ok bool, creationMillis int64) string {
	if !metricSampleValid(ok, usage.Timestamp, creationMillis) {
		return streamrows.MetricsNoData
	}
	return formatCPUMilli(usage.CPUUsageMilli)
}

func formatNodeMetricMemory(usage metrics.NodeUsage, ok bool, creationMillis int64) string {
	if !metricSampleValid(ok, usage.Timestamp, creationMillis) {
		return streamrows.MetricsNoData
	}
	return formatMemoryBytes(usage.MemoryUsageBytes)
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
