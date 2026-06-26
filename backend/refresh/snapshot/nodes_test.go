package snapshot

import (
	"context"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
)

type fakeMetricsProvider struct {
	usage    map[string]metrics.NodeUsage
	podUsage map[string]metrics.PodUsage
	metadata metrics.Metadata
}

func (f fakeMetricsProvider) LatestNodeUsage() map[string]metrics.NodeUsage {
	out := make(map[string]metrics.NodeUsage, len(f.usage))
	for k, v := range f.usage {
		out[k] = v
	}
	return out
}

func (f fakeMetricsProvider) LatestPodUsage() map[string]metrics.PodUsage {
	out := make(map[string]metrics.PodUsage, len(f.podUsage))
	for k, v := range f.podUsage {
		out[k] = v
	}
	return out
}

func (f fakeMetricsProvider) Metadata() metrics.Metadata {
	return f.metadata
}

// newNodeBuilderForTest builds a NodeBuilder wired the production way: node OWN-rows are served
// from a maintained store fed the SAME Table-half NodeSummary rows the node reflector projects
// (via the store's Sink, mirroring pods_store_scope_test.go), while the ingest source still
// supplies the per-node pod aggregates + the node version watermark RV. meta stamps the store +
// own-row cluster identity; nodeRV drives the version watermark; the typed pods (via ingest) and
// metrics provider come from the caller.
func newNodeBuilderForTest(meta ClusterMeta, nodeRV string, provider metrics.Provider, ingest nodeDomainIngestSource, nodes ...*corev1.Node) *NodeBuilder {
	maintained := newTypedMaintainedStore(meta, nodesQuerypageSchema(), nodeTableQueryAdapter())
	sink := maintained.Sink()
	for _, node := range nodes {
		if node == nil {
			continue
		}
		sink.Upsert(buildNodeOwnSummary(meta, node))
	}
	return &NodeBuilder{
		maintained: maintained,
		ingest:     ingest,
		metrics:    provider,
	}
}

func TestNodeBuilderBuild(t *testing.T) {
	collectedAt := time.Now().Add(-30 * time.Second)
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "node-1",
			CreationTimestamp: metav1.NewTime(time.Now().Add(-2 * time.Hour)),
			ResourceVersion:   "42",
			Labels: map[string]string{
				"node-role.kubernetes.io/control-plane": "",
				"node-role.kubernetes.io/worker":        "",
				"node-role.kubernetes.io/custom":        "",
			},
			Annotations: map[string]string{
				"example": "annotation",
			},
		},
		Spec: corev1.NodeSpec{
			Unschedulable: true,
			Taints: []corev1.Taint{{
				Key:    "node.kubernetes.io/unreachable",
				Effect: corev1.TaintEffectNoSchedule,
			}},
		},
		Status: corev1.NodeStatus{
			NodeInfo: corev1.NodeSystemInfo{
				KubeletVersion: "v1.29.0",
			},
			Addresses: []corev1.NodeAddress{
				{Type: corev1.NodeInternalIP, Address: "10.0.0.5"},
				{Type: corev1.NodeExternalIP, Address: "35.1.1.9"},
			},
			Conditions: []corev1.NodeCondition{{
				Type:   corev1.NodeReady,
				Status: corev1.ConditionTrue,
			}},
			Capacity: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("8"),
				corev1.ResourceMemory: resource.MustParse("32Gi"),
				corev1.ResourcePods:   resource.MustParse("110"),
			},
			Allocatable: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("7"),
				corev1.ResourceMemory: resource.MustParse("30Gi"),
				corev1.ResourcePods:   resource.MustParse("100"),
			},
		},
	}

	podA := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "pod-a",
			Namespace: "default",
		},
		Spec: corev1.PodSpec{
			NodeName: "node-1",
			Containers: []corev1.Container{{
				Name: "c1",
				Resources: corev1.ResourceRequirements{
					Requests: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("250m"),
						corev1.ResourceMemory: resource.MustParse("256Mi"),
					},
					Limits: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("500m"),
						corev1.ResourceMemory: resource.MustParse("1Gi"),
					},
				},
			}},
		},
		Status: corev1.PodStatus{
			ContainerStatuses: []corev1.ContainerStatus{{
				Name:         "c1",
				RestartCount: 1,
			}},
		},
	}

	podB := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "pod-b",
			Namespace: "kube-system",
		},
		Spec: corev1.PodSpec{
			NodeName: "node-1",
			Containers: []corev1.Container{{
				Name: "c2",
				Resources: corev1.ResourceRequirements{
					Requests: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("500m"),
						corev1.ResourceMemory: resource.MustParse("512Mi"),
					},
					Limits: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("700m"),
						corev1.ResourceMemory: resource.MustParse("512Mi"),
					},
				},
			}},
		},
		Status: corev1.PodStatus{
			ContainerStatuses: []corev1.ContainerStatus{{
				Name:         "c2",
				RestartCount: 2,
			}},
		},
	}

	podOther := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "pod-c",
			Namespace: "default",
		},
		Spec: corev1.PodSpec{
			NodeName: "node-2",
		},
	}

	provider := fakeMetricsProvider{
		usage: map[string]metrics.NodeUsage{
			"node-1": {
				CPUUsageMilli:    650,
				MemoryUsageBytes: 512 * 1024 * 1024,
			},
		},
		podUsage: map[string]metrics.PodUsage{
			"default/pod-a": {
				CPUUsageMilli:    125,
				MemoryUsageBytes: 128 * 1024 * 1024,
			},
			"kube-system/pod-b": {
				CPUUsageMilli:    250,
				MemoryUsageBytes: 64 * 1024 * 1024,
			},
		},
		metadata: metrics.Metadata{
			CollectedAt:  collectedAt,
			SuccessCount: 7,
			FailureCount: 2,
		},
	}
	ingest := newFakePodAggregateSource(nil, podA, podB, podOther).withNodes(ClusterMeta{}, "42", node)
	builder := newNodeBuilderForTest(ClusterMeta{}, "42", provider, ingest, node)

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)
	require.NotNil(t, snapshot)

	payload, ok := snapshot.Payload.(NodeSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Rows, 1)

	summary := payload.Rows[0]

	require.Equal(t, "node-1", summary.Name)
	require.Equal(t, "Ready (Cordoned)", summary.Status)
	require.Equal(t, "True", summary.StatusState)
	require.Equal(t, "cordoned", summary.StatusPresentation)
	require.Equal(t, "Unschedulable", summary.StatusReason)
	require.Equal(t, "control-plane,custom,worker", summary.Roles)
	require.Equal(t, "v1.29.0", summary.Version)
	require.Equal(t, "10.0.0.5", summary.InternalIP)
	require.Equal(t, "35.1.1.9", summary.ExternalIP)

	require.Equal(t, "8", summary.CPUCapacity)
	require.Equal(t, "7", summary.CPUAllocatable)
	require.Equal(t, "650m", summary.CPUUsage)
	require.Equal(t, "1200m", summary.CPULimits)
	require.Equal(t, "750m", summary.CPURequests)

	require.Equal(t, "32.0 GB", summary.MemoryCapacity)
	require.Equal(t, "30.0 GB", summary.MemoryAllocatable)
	require.Equal(t, "512 MB", summary.MemoryUsage)
	require.Equal(t, "768 MB", summary.MemRequests)
	require.Equal(t, "1.5 GB", summary.MemLimits)

	require.Equal(t, "2/110", summary.Pods)
	require.Equal(t, "110", summary.PodsCapacity)
	require.Equal(t, "100", summary.PodsAllocatable)
	require.Equal(t, int32(3), summary.Restarts)
	require.Equal(t, "node", summary.Kind)
	require.Equal(t, "8", summary.CPU)
	require.Equal(t, "32.0 GB", summary.Memory)
	require.True(t, summary.Unschedulable)
	require.Len(t, summary.PodMetrics, 2)
	require.Contains(t, summary.PodMetrics, NodePodMetric{
		Namespace:   "default",
		Name:        "pod-a",
		CPUUsage:    "125m",
		MemoryUsage: "128 MB",
	})
	require.Contains(t, summary.PodMetrics, NodePodMetric{
		Namespace:   "kube-system",
		Name:        "pod-b",
		CPUUsage:    "250m",
		MemoryUsage: "64 MB",
	})

	require.False(t, payload.Metrics.Stale)
	require.Equal(t, collectedAt.Unix(), payload.Metrics.CollectedAt)
	require.Equal(t, 0, payload.Metrics.ConsecutiveFailures)
	require.Empty(t, payload.Metrics.LastError)
	require.Equal(t, uint64(7), payload.Metrics.SuccessCount)
	require.Equal(t, uint64(2), payload.Metrics.FailureCount)

	require.Len(t, summary.Taints, 1)
	require.Equal(t, NodeTaint{
		Key:    "node.kubernetes.io/unreachable",
		Effect: string(corev1.TaintEffectNoSchedule),
	}, summary.Taints[0])

	// Ensure maps are deep-copied
	require.Equal(t, "annotation", summary.Annotations["example"])
	node.Annotations["example"] = "mutated"
	require.Equal(t, "annotation", summary.Annotations["example"])

	require.Equal(t, uint64(42), snapshot.Version)
}

func TestNodeBuilderMetricRefreshDoesNotChangeSnapshotVersion(t *testing.T) {
	now := time.Unix(1000, 0)
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "node-1",
			ResourceVersion:   "42",
			CreationTimestamp: metav1.NewTime(now.Add(-time.Hour)),
		},
	}
	ingest := newFakePodAggregateSource(nil).withNodes(ClusterMeta{}, "42", node)
	builder := newNodeBuilderForTest(
		ClusterMeta{},
		"42",
		fakeMetricsProvider{
			usage:    map[string]metrics.NodeUsage{"node-1": {CPUUsageMilli: 650}},
			metadata: metrics.Metadata{CollectedAt: now},
		},
		ingest,
		node,
	)

	first, err := builder.Build(context.Background(), "")
	require.NoError(t, err)
	require.Equal(t, uint64(42), first.Version)
	require.Equal(t, strconv.FormatInt(now.UnixNano(), 10), first.SourceVersions["metric"])
	require.Equal(t, "650m", first.Payload.(NodeSnapshot).Rows[0].CPUUsage)

	builder.metrics = fakeMetricsProvider{
		usage:    map[string]metrics.NodeUsage{"node-1": {CPUUsageMilli: 700}},
		metadata: metrics.Metadata{CollectedAt: now.Add(5 * time.Second)},
	}

	second, err := builder.Build(context.Background(), "")
	require.NoError(t, err)
	require.Equal(t, first.Version, second.Version)
	require.Equal(t, strconv.FormatInt(now.Add(5*time.Second).UnixNano(), 10), second.SourceVersions["metric"])
	require.Equal(t, "700m", second.Payload.(NodeSnapshot).Rows[0].CPUUsage)
}

// A malformed query scope must be rejected like every other typed builder does
// — silently serving default-ordered rows under the requested identity is a
// boundary contract hole.
func TestNodeBuilderRejectsMalformedQueryScope(t *testing.T) {
	builder := newNodeBuilderForTest(
		ClusterMeta{},
		"",
		fakeMetricsProvider{},
		newFakePodAggregateSource(nil).withNodes(ClusterMeta{}, ""),
	)

	// `%zz` is an invalid percent-encoding, so the query string cannot parse.
	_, err := builder.Build(context.Background(), "cluster-a|?limit=%zz")
	require.Error(t, err)
}

func TestNodeBuilderCapsLargeSnapshots(t *testing.T) {
	nodes := make([]*corev1.Node, 0, config.SnapshotClusterNodesEntryLimit+1)
	for i := 0; i < config.SnapshotClusterNodesEntryLimit+1; i++ {
		nodes = append(nodes, &corev1.Node{
			ObjectMeta: metav1.ObjectMeta{
				Name:            "node-" + time.Unix(int64(i), 0).Format("150405"),
				ResourceVersion: "1",
			},
			Status: corev1.NodeStatus{
				Capacity: corev1.ResourceList{
					corev1.ResourceCPU:    resource.MustParse("1"),
					corev1.ResourceMemory: resource.MustParse("1Gi"),
					corev1.ResourcePods:   resource.MustParse("10"),
				},
				Allocatable: corev1.ResourceList{
					corev1.ResourceCPU:    resource.MustParse("1"),
					corev1.ResourceMemory: resource.MustParse("1Gi"),
					corev1.ResourcePods:   resource.MustParse("10"),
				},
			},
		})
	}

	builder := newNodeBuilderForTest(
		ClusterMeta{},
		"",
		fakeMetricsProvider{},
		newFakePodAggregateSource(nil).withNodes(ClusterMeta{}, "", nodes...),
		nodes...,
	)

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)
	payload := snapshot.Payload.(NodeSnapshot)
	require.Len(t, payload.Rows, config.SnapshotClusterNodesEntryLimit)
	require.True(t, snapshot.Stats.Truncated)
	require.Equal(t, config.SnapshotClusterNodesEntryLimit+1, snapshot.Stats.TotalItems)
	require.Contains(t, snapshot.Stats.Warnings[0], "nodes")
}

// TestNodesSortByMetricUsage pins that the nodes table sorts by LIVE metric usage numerically
// (the metrics overlaid at serve), not lexically by the formatted string. The cpu values are
// chosen so a lexical sort ("1000m" < "125m" < "650m") differs from the numeric one
// (1000 > 650 > 125); likewise memory ("1 GB" sorts lexically below "128 MB"). This is the
// stage-2.7 regression: nodes metrics are honored in the query sort schema.
func TestNodesSortByMetricUsage(t *testing.T) {
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "c1", ClusterName: "cluster-one"})
	items := []NodeSummary{
		{Name: "alpha", CPUUsage: "1000m", MemoryUsage: "128 MB"},
		{Name: "beta", CPUUsage: "650m", MemoryUsage: "1 GB"},
		{Name: "gamma", CPUUsage: "125m", MemoryUsage: "512 MB"},
	}

	cpuSnap, err := finishNodeSnapshot(ctx, "c1|?sort=cpu&sortDirection=desc", items, 1, metrics.Metadata{})
	require.NoError(t, err)
	require.Equal(t, []string{"alpha", "beta", "gamma"}, nodeRowNames(cpuSnap.Payload.(NodeSnapshot)),
		"cpu sort must be numeric live usage (1000 > 650 > 125), not lexical")

	memSnap, err := finishNodeSnapshot(ctx, "c1|?sort=memory&sortDirection=desc", items, 1, metrics.Metadata{})
	require.NoError(t, err)
	require.Equal(t, []string{"beta", "gamma", "alpha"}, nodeRowNames(memSnap.Payload.(NodeSnapshot)),
		"memory sort must be numeric live usage (1GB > 512MB > 128MB), not lexical")
}

func nodeRowNames(payload NodeSnapshot) []string {
	names := make([]string, len(payload.Rows))
	for i, r := range payload.Rows {
		names[i] = r.Name
	}
	return names
}

// TestNodeMaintainedStoreSpillRestoreRoundTrip proves the nodes maintained store — the new
// per-cluster store of node OWN-rows fed by the node reflector's Sink — spills to disk and
// restores into a fresh store with identical rows, the warm-paint capability the governor's
// Cold/re-warm uses. It goes through the nodes schema + adapter (nodesQuerypageSchema /
// nodeTableQueryAdapter), so it proves the node store wiring round-trips, not just the raw
// querypage.Store. The registry-level spill (domain/maintained_stores_test.go) covers nodes
// generically once RegisterNodeDomain registers it; this pins the node-specific row schema.
func TestNodeMaintainedStoreSpillRestoreRoundTrip(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster-one"}
	available := map[string]bool{"node": true}

	nodeFor := func(name string) *corev1.Node {
		return &corev1.Node{
			ObjectMeta: metav1.ObjectMeta{Name: name, ResourceVersion: "1"},
			Status: corev1.NodeStatus{
				NodeInfo:  corev1.NodeSystemInfo{KubeletVersion: "v1.30.0"},
				Addresses: []corev1.NodeAddress{{Type: corev1.NodeInternalIP, Address: "10.0.0.1"}},
				Capacity: corev1.ResourceList{
					corev1.ResourceCPU:    resource.MustParse("4"),
					corev1.ResourceMemory: resource.MustParse("8Gi"),
					corev1.ResourcePods:   resource.MustParse("110"),
				},
				Allocatable: corev1.ResourceList{
					corev1.ResourceCPU:    resource.MustParse("4"),
					corev1.ResourceMemory: resource.MustParse("8Gi"),
					corev1.ResourcePods:   resource.MustParse("110"),
				},
			},
		}
	}

	orig := newTypedMaintainedStore(meta, nodesQuerypageSchema(), nodeTableQueryAdapter())
	sink := orig.Sink()
	sink.Upsert(buildNodeOwnSummary(meta, nodeFor("node-a")))
	sink.Upsert(buildNodeOwnSummary(meta, nodeFor("node-b")))
	sink.Upsert(buildNodeOwnSummary(meta, nodeFor("node-c")))

	path := filepath.Join(t.TempDir(), "nodes.spill")
	require.NoError(t, orig.SpillTo(path))

	restored := newTypedMaintainedStore(meta, nodesQuerypageSchema(), nodeTableQueryAdapter())
	require.NoError(t, restored.RestoreFrom(path))

	require.ElementsMatch(t, orig.rows("", available), restored.rows("", available),
		"restored nodes maintained store must hold the same own-rows as the spilled one")
}
