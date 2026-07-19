package snapshot

import (
	"context"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/stretchr/testify/require"
)

type namespaceMetricsProvider struct {
	sample metrics.Sample
}

func (p namespaceMetricsProvider) Sample() metrics.Sample { return p.sample }
func (p namespaceMetricsProvider) LatestNodeUsage() map[string]metrics.NodeUsage {
	return p.sample.NodeUsage
}
func (p namespaceMetricsProvider) LatestPodUsage() map[string]metrics.PodUsage {
	return p.sample.PodUsage
}
func (p namespaceMetricsProvider) Metadata() metrics.Metadata { return p.sample.Metadata }

func TestNamespaceMetricsBuilderProjectsOnlyMetricData(t *testing.T) {
	collectedAt := time.Unix(1700000000, 42)
	builder := &NamespaceMetricsBuilder{
		clusterMeta: ClusterMeta{ClusterID: "cluster-a", ClusterName: "alpha"},
		metrics: namespaceMetricsProvider{sample: metrics.Sample{
			PodUsage: map[string]metrics.PodUsage{
				"payments/api":    {CPUUsageMilli: 125, MemoryUsageBytes: 64},
				"payments/worker": {CPUUsageMilli: 75, MemoryUsageBytes: 32},
			},
			Metadata: metrics.Metadata{CollectedAt: collectedAt, SuccessCount: 1},
		}},
	}

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)
	require.Equal(t, "namespace-metrics", snapshot.Domain)
	require.Equal(t, map[string]string{"metric": "1700000000000000042"}, snapshot.SourceVersions)

	payload := snapshot.Payload.(NamespaceMetricsSnapshot)
	require.Equal(t, NamespaceSignalAvailable, payload.MetricsState)
	require.Len(t, payload.Namespaces, 1)
	require.Equal(t, "cluster-a", payload.Namespaces[0].Ref.ClusterID)
	require.Equal(t, "", payload.Namespaces[0].Ref.Group)
	require.Equal(t, "v1", payload.Namespaces[0].Ref.Version)
	require.Equal(t, "Namespace", payload.Namespaces[0].Ref.Kind)
	require.Equal(t, "payments", payload.Namespaces[0].Ref.Name)
	require.Equal(t, int64(200), payload.Namespaces[0].CPUUsageMilli)
	require.Equal(t, int64(96), payload.Namespaces[0].MemoryUsageBytes)
}

func TestNamespaceMetricsBuilderReportsCollectionLifecycle(t *testing.T) {
	build := func(metadata metrics.Metadata) NamespaceMetricsSnapshot {
		builder := &NamespaceMetricsBuilder{
			metrics: namespaceMetricsProvider{sample: metrics.Sample{Metadata: metadata}},
		}
		snapshot, err := builder.Build(context.Background(), "")
		require.NoError(t, err)
		return snapshot.Payload.(NamespaceMetricsSnapshot)
	}

	require.Equal(t, NamespaceSignalLoading, build(metrics.Metadata{}).MetricsState)
	require.Equal(t, NamespaceSignalUnavailable, build(metrics.Metadata{
		FailureCount: 1,
		LastError:    "metrics request failed",
	}).MetricsState)
	require.Equal(t, NamespaceSignalUnavailable, build(metrics.Metadata{
		Disabled:  true,
		LastError: "metrics unavailable",
	}).MetricsState)
}
