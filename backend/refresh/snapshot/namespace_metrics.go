package snapshot

import (
	"context"
	"sort"
	"strings"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/resourcemodel"
)

type namespaceUtilization struct {
	cpuMilli    int64
	memoryBytes int64
}

func namespaceUtilizationRollups(provider metrics.Provider) (map[string]namespaceUtilization, PodMetricsInfo, NamespaceSignalState, string) {
	rollups := make(map[string]namespaceUtilization)
	if provider == nil {
		return rollups, podMetricsInfoFromMetadata(metrics.Metadata{}), NamespaceSignalUnavailable, ""
	}
	sample := provider.Sample()
	info := podMetricsInfoFromMetadata(sample.Metadata)
	if sample.Metadata.Disabled {
		return rollups, info, NamespaceSignalUnavailable, ""
	}
	if sample.Metadata.CollectedAt.IsZero() {
		if sample.Metadata.FailureCount > 0 {
			return rollups, info, NamespaceSignalUnavailable, metricRevisionFromMetadata(sample.Metadata)
		}
		return rollups, info, NamespaceSignalLoading, ""
	}
	for key, usage := range sample.PodUsage {
		namespace, _, ok := strings.Cut(key, "/")
		if !ok || namespace == "" {
			continue
		}
		rollup := rollups[namespace]
		rollup.cpuMilli += usage.CPUUsageMilli
		rollup.memoryBytes += usage.MemoryUsageBytes
		rollups[namespace] = rollup
	}
	return rollups, info, NamespaceSignalAvailable, metricRevisionFromMetadata(sample.Metadata)
}

// NamespaceMetric contains only the volatile utilization associated with one
// Namespace identity. Object-derived namespace fields remain in the namespaces
// domain and never ride the metrics cadence.
type NamespaceMetric struct {
	Ref              resourcemodel.ResourceRef `json:"ref"`
	CPUUsageMilli    int64                     `json:"cpuUsageMilli,omitempty"`
	MemoryUsageBytes int64                     `json:"memoryUsageBytes,omitempty"`
}

// NamespaceMetricsSnapshot is the metric-only companion to NamespaceSnapshot.
type NamespaceMetricsSnapshot struct {
	ClusterMeta
	Namespaces   []NamespaceMetric    `json:"namespaces"`
	Metrics      PodMetricsInfo       `json:"metrics"`
	MetricsState NamespaceSignalState `json:"metricsState"`
}

// NamespaceMetricsBuilder projects the latest shared poller sample without
// reading namespace objects, informers, or ingest stores.
type NamespaceMetricsBuilder struct {
	clusterMeta ClusterMeta
	metrics     metrics.Provider
}

func (b *NamespaceMetricsBuilder) Build(_ context.Context, scope string) (*refresh.Snapshot, error) {
	rollups, metricsInfo, metricsState, metricsRevision := namespaceUtilizationRollups(b.metrics)
	names := make([]string, 0, len(rollups))
	for name := range rollups {
		names = append(names, name)
	}
	sort.Strings(names)

	items := make([]NamespaceMetric, 0, len(names))
	for _, name := range names {
		usage := rollups[name]
		items = append(items, NamespaceMetric{
			Ref: resourcemodel.NewResourceRef(
				b.clusterMeta.ClusterID,
				"",
				"v1",
				"Namespace",
				"namespaces",
				"",
				name,
				"",
			),
			CPUUsageMilli:    usage.cpuMilli,
			MemoryUsageBytes: usage.memoryBytes,
		})
	}

	return &refresh.Snapshot{
		Domain: "namespace-metrics",
		Scope:  scope,
		Payload: NamespaceMetricsSnapshot{
			ClusterMeta:  b.clusterMeta,
			Namespaces:   items,
			Metrics:      metricsInfo,
			MetricsState: metricsState,
		},
		Stats: refresh.SnapshotStats{ItemCount: len(items)},
		SourceVersions: map[string]string{
			"metric": metricsRevision,
		},
	}, nil
}

func RegisterNamespaceMetricsDomain(reg *domain.Registry, provider metrics.Provider, clusterMeta ClusterMeta) error {
	builder := &NamespaceMetricsBuilder{clusterMeta: clusterMeta, metrics: provider}
	return reg.Register(refresh.DomainConfig{
		Name:          "namespace-metrics",
		BuildSnapshot: builder.Build,
	})
}
