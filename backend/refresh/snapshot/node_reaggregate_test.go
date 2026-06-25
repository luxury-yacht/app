package snapshot

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// TestReaggregateNodeSummaryMatchesFullBuild proves the intake/serve split is byte-identical
// to the pre-cut single-pass build: buildNodeOwnSummary (intake) + reaggregateNodeSummary
// (serve) equals the NodeSummary buildNodeSnapshotFromUsage produces for the same node, pod
// aggregates, and metrics. This is the per-node pod-aggregation + PodMetrics + pod-count +
// metrics-overlay gate.
func TestReaggregateNodeSummaryMatchesFullBuild(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c-1", ClusterName: "prod"}
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "node-1",
			ResourceVersion: "100",
			Labels:          map[string]string{"node-role.kubernetes.io/worker": ""},
		},
		Spec: corev1.NodeSpec{Unschedulable: true},
		Status: corev1.NodeStatus{
			Capacity: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("4"),
				corev1.ResourceMemory: resource.MustParse("16Gi"),
				corev1.ResourcePods:   resource.MustParse("110"),
			},
			Allocatable: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("3800m"),
				corev1.ResourceMemory: resource.MustParse("15Gi"),
				corev1.ResourcePods:   resource.MustParse("110"),
			},
			NodeInfo:   corev1.NodeSystemInfo{KubeletVersion: "v1.30.0"},
			Conditions: []corev1.NodeCondition{{Type: corev1.NodeReady, Status: corev1.ConditionTrue}},
			Images:     []corev1.ContainerImage{{Names: []string{"img:tag"}, SizeBytes: 999}},
		},
	}

	aggregates := []streamrows.PodAggregate{
		{
			Namespace:                  "team-a",
			Name:                       "web-1",
			NodeName:                   "node-1",
			CPURequestMilli:            100,
			CPULimitMilli:              200,
			MemRequestBytes:            1 << 20,
			MemLimitBytes:              2 << 20,
			InitCPURequestMilli:        10,
			RestartCountContainersInit: 3,
		},
		{
			Namespace: "team-a",
			Name:      "web-2",
			NodeName:  "node-1",
		},
		// A pod on another node must not contribute to node-1's row.
		{Namespace: "team-b", Name: "other", NodeName: "node-2"},
	}
	podMetrics := map[string]metrics.PodUsage{
		"team-a/web-1": {CPUUsageMilli: 50, MemoryUsageBytes: 1 << 20},
	}
	nodeMetrics := map[string]metrics.NodeUsage{
		"node-1": {CPUUsageMilli: 500, MemoryUsageBytes: 4 << 30},
	}

	// Expected: the full single-pass builder over the typed node.
	snap, err := buildNodeSnapshotFromUsage(
		WithClusterMeta(context.Background(), meta),
		"",
		[]*corev1.Node{node},
		aggregates,
		nodeMetrics,
		podMetrics,
		metrics.Metadata{},
	)
	if err != nil {
		t.Fatalf("buildNodeSnapshotFromUsage error: %v", err)
	}
	payload, ok := snap.Payload.(NodeSnapshot)
	if !ok || len(payload.Rows) != 1 {
		t.Fatalf("expected 1 node row, got payload=%T rows=%d", snap.Payload, len(payload.Rows))
	}
	want := payload.Rows[0]

	// Actual: intake own-row + serve re-join, the cut path's composition.
	own := buildNodeOwnSummary(meta, node)
	nodePods := []streamrows.PodAggregate{aggregates[0], aggregates[1]} // grouped to node-1
	got := reaggregateNodeSummary(own, nodePods, podMetrics, nodeMetrics)

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("reaggregated node row mismatch:\n got=%#v\nwant=%#v", got, want)
	}
}

// TestReaggregateNodeSummaryMissingNodeMetricRendersNoData proves a node with no
// metrics sample renders the no-data marker for CPU/mem usage, never "0m"/"0Mi"
// (Risk #9 / §3.6).
func TestReaggregateNodeSummaryMissingNodeMetricRendersNoData(t *testing.T) {
	own := streamrows.NodeSummary{Name: "node-x", AgeTimestamp: time.Now().Add(-time.Hour).UnixMilli()}
	got := reaggregateNodeSummary(own, nil, map[string]metrics.PodUsage{}, map[string]metrics.NodeUsage{})

	require.Equal(t, streamrows.MetricsNoData, got.CPUUsage)
	require.Equal(t, streamrows.MetricsNoData, got.MemoryUsage)
}

// TestReaggregateNodeSummaryDropsStaleNodeMetric proves a node sample scraped before
// the node's creation (a recreated same-name node) is dropped, rendering no-data
// rather than the prior incarnation's numbers.
func TestReaggregateNodeSummaryDropsStaleNodeMetric(t *testing.T) {
	created := time.Date(2026, 6, 25, 12, 0, 0, 0, time.UTC)
	own := streamrows.NodeSummary{Name: "node-x", AgeTimestamp: created.UnixMilli()}
	staleNodeMetrics := map[string]metrics.NodeUsage{
		"node-x": {CPUUsageMilli: 700, MemoryUsageBytes: 8 << 30, Timestamp: created.Add(-time.Minute)},
	}
	got := reaggregateNodeSummary(own, nil, map[string]metrics.PodUsage{}, staleNodeMetrics)

	require.NotEqual(t, "700m", got.CPUUsage)
	require.Equal(t, streamrows.MetricsNoData, got.CPUUsage)
	require.Equal(t, streamrows.MetricsNoData, got.MemoryUsage)
}

// TestReaggregateNodeSummaryMissingPerPodMetricRendersNoData proves a per-pod entry
// with no metrics sample renders the no-data marker rather than "0m"/"0Mi".
func TestReaggregateNodeSummaryMissingPerPodMetricRendersNoData(t *testing.T) {
	own := streamrows.NodeSummary{Name: "node-x", PodsCapacity: "110"}
	pods := []streamrows.PodAggregate{{Namespace: "ns", Name: "p1", NodeName: "node-x"}}
	got := reaggregateNodeSummary(own, pods, map[string]metrics.PodUsage{}, map[string]metrics.NodeUsage{})

	require.Len(t, got.PodMetrics, 1)
	require.Equal(t, streamrows.MetricsNoData, got.PodMetrics[0].CPUUsage)
	require.Equal(t, streamrows.MetricsNoData, got.PodMetrics[0].MemoryUsage)
}
