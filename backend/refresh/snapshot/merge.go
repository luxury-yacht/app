package snapshot

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/refresh"
	"k8s.io/apimachinery/pkg/api/resource"
)

// MergeSnapshots combines same-domain snapshots into a single payload.
func MergeSnapshots(domain, scope string, snapshots []*refresh.Snapshot) (*refresh.Snapshot, error) {
	if len(snapshots) == 0 {
		return nil, fmt.Errorf("no snapshots to merge for %s", domain)
	}
	if len(snapshots) == 1 {
		return snapshots[0], nil
	}

	switch domain {
	case "namespaces":
		return mergeNamespaceSnapshots(domain, scope, snapshots)
	case namespaceWorkloadsDomainName:
		return mergeNamespaceWorkloads(domain, scope, snapshots)
	case namespaceConfigDomainName:
		return mergeNamespaceConfig(domain, scope, snapshots)
	case namespaceNetworkDomainName:
		return mergeNamespaceNetwork(domain, scope, snapshots)
	case namespaceStorageDomainName:
		return mergeNamespaceStorage(domain, scope, snapshots)
	case namespaceAutoscalingDomainName:
		return mergeNamespaceAutoscaling(domain, scope, snapshots)
	case namespaceQuotasDomainName:
		return mergeNamespaceQuotas(domain, scope, snapshots)
	case namespaceRBACDomainName:
		return mergeNamespaceRBAC(domain, scope, snapshots)
	case namespaceCustomDomainName:
		return mergeNamespaceCustom(domain, scope, snapshots)
	case namespaceHelmDomainName:
		return mergeNamespaceHelm(domain, scope, snapshots)
	case namespaceEventsDomainName:
		return mergeNamespaceEvents(domain, scope, snapshots)
	case podDomainName:
		return mergePodSnapshots(domain, scope, snapshots)
	case "nodes":
		return mergeNodeSnapshots(domain, scope, snapshots)
	case clusterOverviewDomainName:
		return mergeClusterOverview(domain, scope, snapshots)
	case clusterRBACDomainName:
		return mergeClusterRBAC(domain, scope, snapshots)
	case clusterStorageDomainName:
		return mergeClusterStorage(domain, scope, snapshots)
	case clusterConfigDomainName:
		return mergeClusterConfig(domain, scope, snapshots)
	case clusterCRDDomainName:
		return mergeClusterCRDs(domain, scope, snapshots)
	case clusterCustomDomainName:
		return mergeClusterCustom(domain, scope, snapshots)
	case clusterEventsDomainName:
		return mergeClusterEvents(domain, scope, snapshots)
	default:
		return nil, fmt.Errorf("merge not supported for domain %s", domain)
	}
}

// mergeNamespaceSnapshots concatenates namespace summaries and merges stats.
func mergeNamespaceSnapshots(domain, scope string, snapshots []*refresh.Snapshot) (*refresh.Snapshot, error) {
	items := make([]NamespaceSummary, 0)
	stats := make([]refresh.SnapshotStats, 0, len(snapshots))
	var version uint64

	for _, snap := range snapshots {
		payload, ok := snap.Payload.(NamespaceSnapshot)
		if !ok {
			return nil, fmt.Errorf("%s payload mismatch", domain)
		}
		items = append(items, payload.Namespaces...)
		stats = append(stats, snap.Stats)
		version = maxSnapshotVersion(version, snap)
	}

	merged := NamespaceSnapshot{Namespaces: items}
	mergedStats := mergeListStats(stats, len(items))
	return buildMergedSnapshot(domain, scope, version, merged, mergedStats, snapshots)
}

// mergeNamespaceWorkloads concatenates workload summaries and merges stats.
func mergeNamespaceWorkloads(domain, scope string, snapshots []*refresh.Snapshot) (*refresh.Snapshot, error) {
	items := make([]WorkloadSummary, 0)
	stats := make([]refresh.SnapshotStats, 0, len(snapshots))
	var version uint64

	for _, snap := range snapshots {
		payload, ok := snap.Payload.(NamespaceWorkloadsSnapshot)
		if !ok {
			return nil, fmt.Errorf("%s payload mismatch", domain)
		}
		items = append(items, payload.Workloads...)
		stats = append(stats, snap.Stats)
		version = maxSnapshotVersion(version, snap)
	}

	merged := NamespaceWorkloadsSnapshot{Workloads: items}
	mergedStats := mergeListStats(stats, len(items))
	return buildMergedSnapshot(domain, scope, version, merged, mergedStats, snapshots)
}

// mergeNamespaceConfig concatenates config summaries and merges stats.
func mergeNamespaceConfig(domain, scope string, snapshots []*refresh.Snapshot) (*refresh.Snapshot, error) {
	items := make([]ConfigSummary, 0)
	stats := make([]refresh.SnapshotStats, 0, len(snapshots))
	var version uint64

	for _, snap := range snapshots {
		payload, ok := snap.Payload.(NamespaceConfigSnapshot)
		if !ok {
			return nil, fmt.Errorf("%s payload mismatch", domain)
		}
		items = append(items, payload.Resources...)
		stats = append(stats, snap.Stats)
		version = maxSnapshotVersion(version, snap)
	}

	merged := NamespaceConfigSnapshot{Resources: items}
	mergedStats := mergeListStats(stats, len(items))
	return buildMergedSnapshot(domain, scope, version, merged, mergedStats, snapshots)
}

// mergeNamespaceNetwork concatenates network summaries and merges stats.
func mergeNamespaceNetwork(domain, scope string, snapshots []*refresh.Snapshot) (*refresh.Snapshot, error) {
	items := make([]NetworkSummary, 0)
	stats := make([]refresh.SnapshotStats, 0, len(snapshots))
	var version uint64

	for _, snap := range snapshots {
		payload, ok := snap.Payload.(NamespaceNetworkSnapshot)
		if !ok {
			return nil, fmt.Errorf("%s payload mismatch", domain)
		}
		items = append(items, payload.Resources...)
		stats = append(stats, snap.Stats)
		version = maxSnapshotVersion(version, snap)
	}

	merged := NamespaceNetworkSnapshot{Resources: items}
	mergedStats := mergeListStats(stats, len(items))
	return buildMergedSnapshot(domain, scope, version, merged, mergedStats, snapshots)
}

// mergeNamespaceStorage concatenates storage summaries and merges stats.
func mergeNamespaceStorage(domain, scope string, snapshots []*refresh.Snapshot) (*refresh.Snapshot, error) {
	items := make([]StorageSummary, 0)
	stats := make([]refresh.SnapshotStats, 0, len(snapshots))
	var version uint64

	for _, snap := range snapshots {
		payload, ok := snap.Payload.(NamespaceStorageSnapshot)
		if !ok {
			return nil, fmt.Errorf("%s payload mismatch", domain)
		}
		items = append(items, payload.Resources...)
		stats = append(stats, snap.Stats)
		version = maxSnapshotVersion(version, snap)
	}

	merged := NamespaceStorageSnapshot{Resources: items}
	mergedStats := mergeListStats(stats, len(items))
	return buildMergedSnapshot(domain, scope, version, merged, mergedStats, snapshots)
}

// mergeNamespaceAutoscaling concatenates autoscaling summaries and merges stats.
func mergeNamespaceAutoscaling(domain, scope string, snapshots []*refresh.Snapshot) (*refresh.Snapshot, error) {
	items := make([]AutoscalingSummary, 0)
	stats := make([]refresh.SnapshotStats, 0, len(snapshots))
	var version uint64

	for _, snap := range snapshots {
		payload, ok := snap.Payload.(NamespaceAutoscalingSnapshot)
		if !ok {
			return nil, fmt.Errorf("%s payload mismatch", domain)
		}
		items = append(items, payload.Resources...)
		stats = append(stats, snap.Stats)
		version = maxSnapshotVersion(version, snap)
	}

	merged := NamespaceAutoscalingSnapshot{Resources: items}
	mergedStats := mergeListStats(stats, len(items))
	return buildMergedSnapshot(domain, scope, version, merged, mergedStats, snapshots)
}

// mergeNamespaceQuotas concatenates quota summaries and merges stats.
func mergeNamespaceQuotas(domain, scope string, snapshots []*refresh.Snapshot) (*refresh.Snapshot, error) {
	items := make([]QuotaSummary, 0)
	stats := make([]refresh.SnapshotStats, 0, len(snapshots))
	var version uint64

	for _, snap := range snapshots {
		payload, ok := snap.Payload.(NamespaceQuotasSnapshot)
		if !ok {
			return nil, fmt.Errorf("%s payload mismatch", domain)
		}
		items = append(items, payload.Resources...)
		stats = append(stats, snap.Stats)
		version = maxSnapshotVersion(version, snap)
	}

	merged := NamespaceQuotasSnapshot{Resources: items}
	mergedStats := mergeListStats(stats, len(items))
	return buildMergedSnapshot(domain, scope, version, merged, mergedStats, snapshots)
}

// mergeNamespaceRBAC concatenates RBAC summaries and merges stats.
func mergeNamespaceRBAC(domain, scope string, snapshots []*refresh.Snapshot) (*refresh.Snapshot, error) {
	items := make([]RBACSummary, 0)
	stats := make([]refresh.SnapshotStats, 0, len(snapshots))
	var version uint64

	for _, snap := range snapshots {
		payload, ok := snap.Payload.(NamespaceRBACSnapshot)
		if !ok {
			return nil, fmt.Errorf("%s payload mismatch", domain)
		}
		items = append(items, payload.Resources...)
		stats = append(stats, snap.Stats)
		version = maxSnapshotVersion(version, snap)
	}

	merged := NamespaceRBACSnapshot{Resources: items}
	mergedStats := mergeListStats(stats, len(items))
	return buildMergedSnapshot(domain, scope, version, merged, mergedStats, snapshots)
}

// mergeNamespaceCustom concatenates custom resource summaries and merges stats.
func mergeNamespaceCustom(domain, scope string, snapshots []*refresh.Snapshot) (*refresh.Snapshot, error) {
	items := make([]NamespaceCustomSummary, 0)
	stats := make([]refresh.SnapshotStats, 0, len(snapshots))
	var version uint64

	for _, snap := range snapshots {
		payload, ok := snap.Payload.(NamespaceCustomSnapshot)
		if !ok {
			return nil, fmt.Errorf("%s payload mismatch", domain)
		}
		items = append(items, payload.Resources...)
		stats = append(stats, snap.Stats)
		version = maxSnapshotVersion(version, snap)
	}

	merged := NamespaceCustomSnapshot{Resources: items}
	mergedStats := mergeListStats(stats, len(items))
	return buildMergedSnapshot(domain, scope, version, merged, mergedStats, snapshots)
}

// mergeNamespaceHelm concatenates Helm release summaries and merges stats.
func mergeNamespaceHelm(domain, scope string, snapshots []*refresh.Snapshot) (*refresh.Snapshot, error) {
	items := make([]NamespaceHelmSummary, 0)
	stats := make([]refresh.SnapshotStats, 0, len(snapshots))
	var version uint64

	for _, snap := range snapshots {
		payload, ok := snap.Payload.(NamespaceHelmSnapshot)
		if !ok {
			return nil, fmt.Errorf("%s payload mismatch", domain)
		}
		items = append(items, payload.Releases...)
		stats = append(stats, snap.Stats)
		version = maxSnapshotVersion(version, snap)
	}

	merged := NamespaceHelmSnapshot{Releases: items}
	mergedStats := mergeListStats(stats, len(items))
	return buildMergedSnapshot(domain, scope, version, merged, mergedStats, snapshots)
}

// mergeNamespaceEvents concatenates namespace events and merges stats.
func mergeNamespaceEvents(domain, scope string, snapshots []*refresh.Snapshot) (*refresh.Snapshot, error) {
	items := make([]EventSummary, 0)
	stats := make([]refresh.SnapshotStats, 0, len(snapshots))
	var version uint64

	for _, snap := range snapshots {
		payload, ok := snap.Payload.(NamespaceEventsSnapshot)
		if !ok {
			return nil, fmt.Errorf("%s payload mismatch", domain)
		}
		items = append(items, payload.Events...)
		stats = append(stats, snap.Stats)
		version = maxSnapshotVersion(version, snap)
	}

	merged := NamespaceEventsSnapshot{Events: items}
	mergedStats := mergeListStats(stats, len(items))
	return buildMergedSnapshot(domain, scope, version, merged, mergedStats, snapshots)
}

// mergePodSnapshots concatenates pod summaries and merges metrics/stats.
func mergePodSnapshots(domain, scope string, snapshots []*refresh.Snapshot) (*refresh.Snapshot, error) {
	items := make([]PodSummary, 0)
	stats := make([]refresh.SnapshotStats, 0, len(snapshots))
	metricInputs := make([]metricFields, 0, len(snapshots))
	var version uint64

	for _, snap := range snapshots {
		payload, ok := snap.Payload.(PodSnapshot)
		if !ok {
			return nil, fmt.Errorf("%s payload mismatch", domain)
		}
		items = append(items, payload.Pods...)
		stats = append(stats, snap.Stats)
		metricInputs = append(metricInputs, metricFields{
			collectedAt:         payload.Metrics.CollectedAt,
			stale:               payload.Metrics.Stale,
			lastError:           payload.Metrics.LastError,
			consecutiveFailures: payload.Metrics.ConsecutiveFailures,
			successCount:        payload.Metrics.SuccessCount,
			failureCount:        payload.Metrics.FailureCount,
		})
		version = maxSnapshotVersion(version, snap)
	}

	metrics := mergeMetricFields(metricInputs)
	merged := PodSnapshot{
		Pods: items,
		Metrics: PodMetricsInfo{
			CollectedAt:         metrics.collectedAt,
			Stale:               metrics.stale,
			LastError:           metrics.lastError,
			ConsecutiveFailures: metrics.consecutiveFailures,
			SuccessCount:        metrics.successCount,
			FailureCount:        metrics.failureCount,
		},
	}
	mergedStats := mergeListStats(stats, len(items))
	return buildMergedSnapshot(domain, scope, version, merged, mergedStats, snapshots)
}

// mergeNodeSnapshots concatenates node summaries and merges metrics/stats.
func mergeNodeSnapshots(domain, scope string, snapshots []*refresh.Snapshot) (*refresh.Snapshot, error) {
	items := make([]NodeSummary, 0)
	stats := make([]refresh.SnapshotStats, 0, len(snapshots))
	metricInputs := make([]metricFields, 0, len(snapshots))
	metricsByCluster := make(map[string]NodeMetricsInfo)
	var version uint64

	for _, snap := range snapshots {
		payload, ok := snap.Payload.(NodeSnapshot)
		if !ok {
			return nil, fmt.Errorf("%s payload mismatch", domain)
		}
		items = append(items, payload.Nodes...)
		stats = append(stats, snap.Stats)
		if len(payload.MetricsByCluster) > 0 {
			for id, info := range payload.MetricsByCluster {
				if strings.TrimSpace(id) == "" {
					continue
				}
				metricsByCluster[id] = info
			}
		} else if id := strings.TrimSpace(payload.ClusterID); id != "" {
			metricsByCluster[id] = payload.Metrics
		}
		metricInputs = append(metricInputs, metricFields{
			collectedAt:         payload.Metrics.CollectedAt,
			stale:               payload.Metrics.Stale,
			lastError:           payload.Metrics.LastError,
			consecutiveFailures: payload.Metrics.ConsecutiveFailures,
			successCount:        payload.Metrics.SuccessCount,
			failureCount:        payload.Metrics.FailureCount,
		})
		version = maxSnapshotVersion(version, snap)
	}

	metrics := mergeMetricFields(metricInputs)
	merged := NodeSnapshot{
		Nodes:   items,
		Metrics: NodeMetricsInfo{
			CollectedAt:         metrics.collectedAt,
			Stale:               metrics.stale,
			LastError:           metrics.lastError,
			ConsecutiveFailures: metrics.consecutiveFailures,
			SuccessCount:        metrics.successCount,
			FailureCount:        metrics.failureCount,
		},
	}
	if len(metricsByCluster) > 0 {
		merged.MetricsByCluster = metricsByCluster
	}
	mergedStats := mergeListStats(stats, len(items))
	return buildMergedSnapshot(domain, scope, version, merged, mergedStats, snapshots)
}

// mergeClusterOverview merges cluster overview counters, metrics, and labels.
func mergeClusterOverview(domain, scope string, snapshots []*refresh.Snapshot) (*refresh.Snapshot, error) {
	payloads := make([]ClusterOverviewSnapshot, 0, len(snapshots))
	metricsInputs := make([]metricFields, 0, len(snapshots))
	overviewByCluster := make(map[string]ClusterOverviewPayload)
	metricsByCluster := make(map[string]ClusterOverviewMetrics)
	var version uint64

	for _, snap := range snapshots {
		payload, ok := snap.Payload.(ClusterOverviewSnapshot)
		if !ok {
			return nil, fmt.Errorf("%s payload mismatch", domain)
		}
		payloads = append(payloads, payload)
		if len(payload.OverviewByCluster) > 0 {
			for id, info := range payload.OverviewByCluster {
				if strings.TrimSpace(id) == "" {
					continue
				}
				overviewByCluster[id] = info
			}
		} else if id := strings.TrimSpace(payload.ClusterID); id != "" {
			overviewByCluster[id] = payload.Overview
		}
		if len(payload.MetricsByCluster) > 0 {
			for id, info := range payload.MetricsByCluster {
				if strings.TrimSpace(id) == "" {
					continue
				}
				metricsByCluster[id] = info
			}
		} else if id := strings.TrimSpace(payload.ClusterID); id != "" {
			metricsByCluster[id] = payload.Metrics
		}
		metricsInputs = append(metricsInputs, metricFields{
			collectedAt:         payload.Metrics.CollectedAt,
			stale:               payload.Metrics.Stale,
			lastError:           payload.Metrics.LastError,
			consecutiveFailures: payload.Metrics.ConsecutiveFailures,
			successCount:        payload.Metrics.SuccessCount,
			failureCount:        payload.Metrics.FailureCount,
		})
		version = maxSnapshotVersion(version, snap)
	}

	overview := mergeClusterOverviewPayload(payloads)
	metrics := mergeMetricFields(metricsInputs)
	merged := ClusterOverviewSnapshot{
		Overview: overview,
		Metrics: ClusterOverviewMetrics{
			CollectedAt:         metrics.collectedAt,
			Stale:               metrics.stale,
			LastError:           metrics.lastError,
			ConsecutiveFailures: metrics.consecutiveFailures,
			SuccessCount:        metrics.successCount,
			FailureCount:        metrics.failureCount,
		},
	}
	if len(overviewByCluster) > 0 {
		merged.OverviewByCluster = overviewByCluster
	}
	if len(metricsByCluster) > 0 {
		merged.MetricsByCluster = metricsByCluster
	}
	mergedStats := refresh.SnapshotStats{ItemCount: overview.TotalNodes}
	return buildMergedSnapshot(domain, scope, version, merged, mergedStats, snapshots)
}

// mergeClusterRBAC concatenates cluster RBAC entries and merges stats.
func mergeClusterRBAC(domain, scope string, snapshots []*refresh.Snapshot) (*refresh.Snapshot, error) {
	items := make([]ClusterRBACEntry, 0)
	stats := make([]refresh.SnapshotStats, 0, len(snapshots))
	var version uint64

	for _, snap := range snapshots {
		payload, ok := snap.Payload.(ClusterRBACSnapshot)
		if !ok {
			return nil, fmt.Errorf("%s payload mismatch", domain)
		}
		items = append(items, payload.Resources...)
		stats = append(stats, snap.Stats)
		version = maxSnapshotVersion(version, snap)
	}

	merged := ClusterRBACSnapshot{Resources: items}
	mergedStats := mergeListStats(stats, len(items))
	return buildMergedSnapshot(domain, scope, version, merged, mergedStats, snapshots)
}

// mergeClusterStorage concatenates cluster storage entries and merges stats.
func mergeClusterStorage(domain, scope string, snapshots []*refresh.Snapshot) (*refresh.Snapshot, error) {
	items := make([]ClusterStorageEntry, 0)
	stats := make([]refresh.SnapshotStats, 0, len(snapshots))
	var version uint64

	for _, snap := range snapshots {
		payload, ok := snap.Payload.(ClusterStorageSnapshot)
		if !ok {
			return nil, fmt.Errorf("%s payload mismatch", domain)
		}
		items = append(items, payload.Volumes...)
		stats = append(stats, snap.Stats)
		version = maxSnapshotVersion(version, snap)
	}

	merged := ClusterStorageSnapshot{Volumes: items}
	mergedStats := mergeListStats(stats, len(items))
	return buildMergedSnapshot(domain, scope, version, merged, mergedStats, snapshots)
}

// mergeClusterConfig concatenates cluster config entries and merges stats.
func mergeClusterConfig(domain, scope string, snapshots []*refresh.Snapshot) (*refresh.Snapshot, error) {
	items := make([]ClusterConfigEntry, 0)
	stats := make([]refresh.SnapshotStats, 0, len(snapshots))
	var version uint64

	for _, snap := range snapshots {
		payload, ok := snap.Payload.(ClusterConfigSnapshot)
		if !ok {
			return nil, fmt.Errorf("%s payload mismatch", domain)
		}
		items = append(items, payload.Resources...)
		stats = append(stats, snap.Stats)
		version = maxSnapshotVersion(version, snap)
	}

	merged := ClusterConfigSnapshot{Resources: items}
	mergedStats := mergeListStats(stats, len(items))
	return buildMergedSnapshot(domain, scope, version, merged, mergedStats, snapshots)
}

// mergeClusterCRDs concatenates CRD summaries and merges stats.
func mergeClusterCRDs(domain, scope string, snapshots []*refresh.Snapshot) (*refresh.Snapshot, error) {
	items := make([]ClusterCRDEntry, 0)
	stats := make([]refresh.SnapshotStats, 0, len(snapshots))
	var version uint64

	for _, snap := range snapshots {
		payload, ok := snap.Payload.(ClusterCRDSnapshot)
		if !ok {
			return nil, fmt.Errorf("%s payload mismatch", domain)
		}
		items = append(items, payload.Definitions...)
		stats = append(stats, snap.Stats)
		version = maxSnapshotVersion(version, snap)
	}

	merged := ClusterCRDSnapshot{Definitions: items}
	mergedStats := mergeListStats(stats, len(items))
	return buildMergedSnapshot(domain, scope, version, merged, mergedStats, snapshots)
}

// mergeClusterCustom concatenates cluster custom summaries and merges stats.
func mergeClusterCustom(domain, scope string, snapshots []*refresh.Snapshot) (*refresh.Snapshot, error) {
	items := make([]ClusterCustomSummary, 0)
	stats := make([]refresh.SnapshotStats, 0, len(snapshots))
	var version uint64

	for _, snap := range snapshots {
		payload, ok := snap.Payload.(ClusterCustomSnapshot)
		if !ok {
			return nil, fmt.Errorf("%s payload mismatch", domain)
		}
		items = append(items, payload.Resources...)
		stats = append(stats, snap.Stats)
		version = maxSnapshotVersion(version, snap)
	}

	merged := ClusterCustomSnapshot{Resources: items}
	mergedStats := mergeListStats(stats, len(items))
	return buildMergedSnapshot(domain, scope, version, merged, mergedStats, snapshots)
}

// mergeClusterEvents concatenates cluster events and merges stats.
func mergeClusterEvents(domain, scope string, snapshots []*refresh.Snapshot) (*refresh.Snapshot, error) {
	items := make([]ClusterEventEntry, 0)
	stats := make([]refresh.SnapshotStats, 0, len(snapshots))
	var version uint64

	for _, snap := range snapshots {
		payload, ok := snap.Payload.(ClusterEventsSnapshot)
		if !ok {
			return nil, fmt.Errorf("%s payload mismatch", domain)
		}
		items = append(items, payload.Events...)
		stats = append(stats, snap.Stats)
		version = maxSnapshotVersion(version, snap)
	}

	merged := ClusterEventsSnapshot{Events: items}
	mergedStats := mergeListStats(stats, len(items))
	return buildMergedSnapshot(domain, scope, version, merged, mergedStats, snapshots)
}

// metricFields captures metrics metadata so we can merge across clusters.
type metricFields struct {
	collectedAt         int64
	stale               bool
	lastError           string
	consecutiveFailures int
	successCount        uint64
	failureCount        uint64
}

// mergeMetricFields chooses the freshest metadata while summing counts.
func mergeMetricFields(entries []metricFields) metricFields {
	var out metricFields
	for _, entry := range entries {
		if entry.collectedAt > out.collectedAt {
			out.collectedAt = entry.collectedAt
		}
		if entry.stale {
			out.stale = true
		}
		if out.lastError == "" && entry.lastError != "" {
			out.lastError = entry.lastError
		}
		if entry.consecutiveFailures > out.consecutiveFailures {
			out.consecutiveFailures = entry.consecutiveFailures
		}
		out.successCount += entry.successCount
		out.failureCount += entry.failureCount
	}
	return out
}

// mergeClusterOverviewPayload aggregates counters and resource metrics across clusters.
func mergeClusterOverviewPayload(payloads []ClusterOverviewSnapshot) ClusterOverviewPayload {
	var (
		out                    ClusterOverviewPayload
		cpuUsageMilli          int64
		cpuRequestsMilli       int64
		cpuLimitsMilli         int64
		cpuAllocatableMilli    int64
		memoryUsageBytes       int64
		memoryRequestsBytes    int64
		memoryLimitsBytes      int64
		memoryAllocatableBytes int64
		clusterTypes           = map[string]struct{}{}
		clusterVersions        = map[string]struct{}{}
	)

	for _, payload := range payloads {
		overview := payload.Overview
		out.TotalNodes += overview.TotalNodes
		out.FargateNodes += overview.FargateNodes
		out.RegularNodes += overview.RegularNodes
		out.EC2Nodes += overview.EC2Nodes
		out.TotalPods += overview.TotalPods
		out.TotalContainers += overview.TotalContainers
		out.TotalInitContainers += overview.TotalInitContainers
		out.RunningPods += overview.RunningPods
		out.PendingPods += overview.PendingPods
		out.FailedPods += overview.FailedPods
		out.RestartedPods += overview.RestartedPods
		out.TotalNamespaces += overview.TotalNamespaces

		cpuUsageMilli += parseCPUValue(overview.CPUUsage)
		cpuRequestsMilli += parseCPUValue(overview.CPURequests)
		cpuLimitsMilli += parseCPUValue(overview.CPULimits)
		cpuAllocatableMilli += parseCPUValue(overview.CPUAllocatable)
		memoryUsageBytes += parseMemoryValue(overview.MemoryUsage)
		memoryRequestsBytes += parseMemoryValue(overview.MemoryRequests)
		memoryLimitsBytes += parseMemoryValue(overview.MemoryLimits)
		memoryAllocatableBytes += parseMemoryValue(overview.MemoryAllocatable)

		if value := strings.TrimSpace(overview.ClusterType); value != "" {
			clusterTypes[value] = struct{}{}
		}
		if value := strings.TrimSpace(overview.ClusterVersion); value != "" {
			clusterVersions[value] = struct{}{}
		}
	}

	out.CPUUsage = formatCPUValue(cpuUsageMilli)
	out.CPURequests = formatCPUValue(cpuRequestsMilli)
	out.CPULimits = formatCPUValue(cpuLimitsMilli)
	out.CPUAllocatable = formatCPUValue(cpuAllocatableMilli)
	out.MemoryUsage = formatMemoryValue(memoryUsageBytes)
	out.MemoryRequests = formatMemoryValue(memoryRequestsBytes)
	out.MemoryLimits = formatMemoryValue(memoryLimitsBytes)
	out.MemoryAllocatable = formatMemoryValue(memoryAllocatableBytes)
	out.ClusterType = mergeLabel(clusterTypes, "Mixed")
	out.ClusterVersion = mergeLabel(clusterVersions, "Multiple")

	return out
}

// mergeLabel returns the single label value or a mixed sentinel if multiple values exist.
func mergeLabel(values map[string]struct{}, mixed string) string {
	if len(values) == 0 {
		return ""
	}
	if len(values) == 1 {
		for value := range values {
			return value
		}
	}
	return mixed
}

// parseCPUValue returns milli-CPU for a formatted CPU string.
func parseCPUValue(value string) int64 {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return 0
	}
	qty, err := resource.ParseQuantity(trimmed)
	if err != nil {
		return 0
	}
	return qty.MilliValue()
}

// parseMemoryValue returns bytes for a formatted memory string.
func parseMemoryValue(value string) int64 {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return 0
	}
	qty, err := resource.ParseQuantity(trimmed)
	if err != nil {
		return 0
	}
	return qty.Value()
}

// mergeListStats combines list snapshot stats for aggregated payloads.
func mergeListStats(stats []refresh.SnapshotStats, itemCount int) refresh.SnapshotStats {
	merged := refresh.SnapshotStats{ItemCount: itemCount}
	for _, stat := range stats {
		if stat.TotalItems > 0 {
			merged.TotalItems += stat.TotalItems
		}
		if stat.Truncated {
			merged.Truncated = true
		}
		if len(stat.Warnings) > 0 {
			merged.Warnings = append(merged.Warnings, stat.Warnings...)
		}
	}
	return merged
}

// maxSnapshotVersion picks the highest resource version across snapshots.
func maxSnapshotVersion(current uint64, snap *refresh.Snapshot) uint64 {
	if snap != nil && snap.Version > current {
		return snap.Version
	}
	return current
}

// maxSnapshotSequence keeps the newest sequence across component snapshots.
func maxSnapshotSequence(snapshots []*refresh.Snapshot) uint64 {
	var max uint64
	for _, snap := range snapshots {
		if snap != nil && snap.Sequence > max {
			max = snap.Sequence
		}
	}
	return max
}

// buildMergedSnapshot stamps metadata and computes a checksum for merged payloads.
func buildMergedSnapshot(
	domain,
	scope string,
	version uint64,
	payload interface{},
	stats refresh.SnapshotStats,
	snapshots []*refresh.Snapshot,
) (*refresh.Snapshot, error) {
	merged := &refresh.Snapshot{
		Domain:      domain,
		Scope:       scope,
		Version:     version,
		GeneratedAt: time.Now().UnixMilli(),
		Sequence:    maxSnapshotSequence(snapshots),
		Payload:     payload,
		Stats:       stats,
	}

	if payload != nil {
		data, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}
		merged.Checksum = checksumBytes(data)
	}

	return merged, nil
}
