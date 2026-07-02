package snapshot

// Serve-time metric join contract: the BASE table domains (nodes, pods,
// namespace-workloads) overlay live poller usage onto their served rows at
// serve, publish the poller metadata block, and stamp the metric revision as a
// source clock — while the object snapshot Version stays object-clocked and
// the stored rows are never re-projected by a metric tick. This replaces the
// separate *-metrics domains (and the frontend rowKeys overlay round-trips).

import (
	"context"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
	podres "github.com/luxury-yacht/app/backend/resources/pods"
)

func TestNodeSnapshotOverlaysLiveUsageAtServe(t *testing.T) {
	// Freshness (Stale) is judged against the wall clock, so the sample must be recent.
	now := time.Now().Truncate(time.Second)
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "node-1",
			ResourceVersion:   "42",
			CreationTimestamp: metav1.NewTime(now.Add(-time.Hour)),
		},
	}
	ingest := newFakePodAggregateSource(nil).withNodes(ClusterMeta{}, "42", node)
	builder := newNodeBuilderForTest(ClusterMeta{}, ingest, node)
	builder.metrics = fakeMetricsProvider{
		usage:    map[string]metrics.NodeUsage{"node-1": {CPUUsageMilli: 650}},
		metadata: metrics.Metadata{CollectedAt: now},
	}

	first, err := builder.Build(context.Background(), "")
	require.NoError(t, err)
	payload := first.Payload.(NodeSnapshot)
	require.Len(t, payload.Rows, 1)
	require.Equal(t, "650m", payload.Rows[0].CPUUsage)
	require.Equal(t, uint64(42), first.Version)
	require.Equal(t, strconv.FormatInt(now.UnixNano(), 10), first.SourceVersions["metric"])
	require.False(t, payload.Metrics.Stale)

	// A metric tick advances ONLY the metric source clock — the object version
	// must not move, and the served usage must follow the poller.
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

func TestNodeSnapshotPublishesMetricMetadata(t *testing.T) {
	collectedAt := time.Now().Add(-time.Hour)
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "node-1",
			ResourceVersion:   "42",
			CreationTimestamp: metav1.NewTime(collectedAt.Add(-time.Hour)),
		},
	}
	ingest := newFakePodAggregateSource(nil).withNodes(ClusterMeta{}, "42", node)
	builder := newNodeBuilderForTest(ClusterMeta{}, ingest, node)
	builder.metrics = fakeMetricsProvider{
		metadata: metrics.Metadata{
			CollectedAt:         collectedAt,
			LastError:           "metrics API forbidden",
			ConsecutiveFailures: 2,
			SuccessCount:        3,
			FailureCount:        5,
		},
	}

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)
	payload := snapshot.Payload.(NodeSnapshot)
	require.True(t, payload.Metrics.Stale)
	require.Equal(t, "metrics API forbidden", payload.Metrics.LastError)
	require.Equal(t, 2, payload.Metrics.ConsecutiveFailures)
	require.Equal(t, uint64(3), payload.Metrics.SuccessCount)
	require.Equal(t, uint64(5), payload.Metrics.FailureCount)
	require.Equal(t, collectedAt.Unix(), payload.Metrics.CollectedAt)
}

// TestNodeQuerySortsByLiveUsage pins that the BASE nodes query sorts by live
// metric usage numerically (overlaid at serve), not lexically by the formatted
// string. The cpu values are chosen so a lexical sort ("1000m" < "125m" <
// "650m") differs from the numeric one (1000 > 650 > 125); likewise memory
// ("1 GB" sorts lexically below "128 MB").
func TestNodeQuerySortsByLiveUsage(t *testing.T) {
	items := []NodeSummary{
		{Name: "alpha", CPUUsage: "1000m", MemoryUsage: "128 MB"},
		{Name: "beta", CPUUsage: "650m", MemoryUsage: "1 GB"},
		{Name: "gamma", CPUUsage: "125m", MemoryUsage: "512 MB"},
	}

	_, cpuQuery, err := parseTypedTableQueryScope("c1", "?sort=cpu&sortDirection=desc", "nodes", "rev-1")
	require.NoError(t, err)
	cpuPage := applyTypedTableQueryViaStore(items, cpuQuery, nodeTableQueryAdapter(), nodesQuerypageSchema())
	require.Equal(t, []string{"alpha", "beta", "gamma"}, nodeSummaryNames(cpuPage.Rows),
		"cpu sort must be numeric live usage (1000 > 650 > 125), not lexical")

	_, memQuery, err := parseTypedTableQueryScope("c1", "?sort=memory&sortDirection=desc", "nodes", "rev-1")
	require.NoError(t, err)
	memPage := applyTypedTableQueryViaStore(items, memQuery, nodeTableQueryAdapter(), nodesQuerypageSchema())
	require.Equal(t, []string{"beta", "gamma", "alpha"}, nodeSummaryNames(memPage.Rows),
		"memory sort must be numeric live usage (1GB > 512MB > 128MB), not lexical")
}

func TestNodeQueryCapabilitiesPublishMetricSorts(t *testing.T) {
	capabilities := nodeQueryCapabilities()
	require.Contains(t, capabilities.SortableFields, "cpu")
	require.Contains(t, capabilities.SortableFields, "memory")
}

func nodeSummaryNames(rows []NodeSummary) []string {
	names := make([]string, len(rows))
	for i, r := range rows {
		names[i] = r.Name
	}
	return names
}

func TestPodSnapshotOverlaysLiveUsageAtServe(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "api",
			Namespace:         "default",
			CreationTimestamp: metav1.NewTime(now.Add(-time.Hour)),
			ResourceVersion:   "17",
		},
		Status: corev1.PodStatus{Phase: corev1.PodRunning},
	}
	maintained := newTypedMaintainedStore(ClusterMeta{}, podQuerypageSchema(), podTableQueryAdapter())
	maintained.Sink().Upsert(podSummaryWithoutMetrics(podres.BuildStreamSummaryFromRSMap(ClusterMeta{}, pod, 0, 0, nil)))
	builder := &PodBuilder{
		maintained: maintained,
		metrics: fakeMetricsProvider{
			podUsage: map[string]metrics.PodUsage{
				"default/api": {CPUUsageMilli: 250, MemoryUsageBytes: 512 << 20, Timestamp: now},
			},
			metadata: metrics.Metadata{CollectedAt: now},
		},
	}

	first, err := builder.Build(context.Background(), "namespace:default")
	require.NoError(t, err)
	payload := first.Payload.(PodSnapshot)
	require.Len(t, payload.Rows, 1)
	require.Equal(t, "250m", payload.Rows[0].CPUUsage)
	require.Equal(t, strconv.FormatInt(now.UnixNano(), 10), first.SourceVersions["metric"])
	require.False(t, payload.Metrics.Stale)

	// The join happens on served copies only: the maintained store's rows must
	// keep the no-data marker (a metric tick never re-projects stored rows).
	stored := maintained.rows("", map[string]bool{podres.Identity.Kind: true})
	require.Len(t, stored, 1)
	require.Equal(t, streamrows.MetricsNoData, stored[0].CPUUsage)

	// A metric tick advances only the metric source clock.
	builder.metrics = fakeMetricsProvider{
		podUsage: map[string]metrics.PodUsage{
			"default/api": {CPUUsageMilli: 300, Timestamp: now.Add(5 * time.Second)},
		},
		metadata: metrics.Metadata{CollectedAt: now.Add(5 * time.Second)},
	}
	second, err := builder.Build(context.Background(), "namespace:default")
	require.NoError(t, err)
	require.Equal(t, first.Version, second.Version)
	require.Equal(t, "300m", second.Payload.(PodSnapshot).Rows[0].CPUUsage)
	require.Equal(t, strconv.FormatInt(now.Add(5*time.Second).UnixNano(), 10), second.SourceVersions["metric"])
}

// A usage sample scraped before the pod was created belongs to a prior
// incarnation of a same-named pod and must render the no-data marker.
func TestPodSnapshotRejectsStaleSampleForRecreatedPod(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "api",
			Namespace:         "default",
			CreationTimestamp: metav1.NewTime(now),
			ResourceVersion:   "18",
		},
		Status: corev1.PodStatus{Phase: corev1.PodRunning},
	}
	maintained := newTypedMaintainedStore(ClusterMeta{}, podQuerypageSchema(), podTableQueryAdapter())
	maintained.Sink().Upsert(podSummaryWithoutMetrics(podres.BuildStreamSummaryFromRSMap(ClusterMeta{}, pod, 0, 0, nil)))
	builder := &PodBuilder{
		maintained: maintained,
		metrics: fakeMetricsProvider{
			podUsage: map[string]metrics.PodUsage{
				"default/api": {CPUUsageMilli: 250, Timestamp: now.Add(-time.Minute)},
			},
			metadata: metrics.Metadata{CollectedAt: now},
		},
	}

	snapshot, err := builder.Build(context.Background(), "namespace:default")
	require.NoError(t, err)
	payload := snapshot.Payload.(PodSnapshot)
	require.Len(t, payload.Rows, 1)
	require.Equal(t, streamrows.MetricsNoData, payload.Rows[0].CPUUsage)
	require.Equal(t, streamrows.MetricsNoData, payload.Rows[0].MemUsage)
}

func TestPodQuerySortsByLiveUsage(t *testing.T) {
	items := []PodSummary{
		{Name: "alpha", Namespace: "default", CPUUsage: "1000m", MemUsage: "128 MB"},
		{Name: "beta", Namespace: "default", CPUUsage: "650m", MemUsage: "1 GB"},
		{Name: "gamma", Namespace: "default", CPUUsage: "125m", MemUsage: "512 MB"},
	}

	_, cpuQuery, err := parseTypedTableQueryScope("c1", "namespace:default?sort=cpu&sortDirection=desc", podDomainName, "rev-1")
	require.NoError(t, err)
	cpuPage := applyTypedTableQueryViaStore(items, cpuQuery, podTableQueryAdapter(), podQuerypageSchema())
	require.Equal(t, []string{"alpha", "beta", "gamma"}, podSummaryNames(cpuPage.Rows),
		"cpu sort must be numeric live usage (1000 > 650 > 125), not lexical")

	_, memQuery, err := parseTypedTableQueryScope("c1", "namespace:default?sort=memory&sortDirection=desc", podDomainName, "rev-1")
	require.NoError(t, err)
	memPage := applyTypedTableQueryViaStore(items, memQuery, podTableQueryAdapter(), podQuerypageSchema())
	require.Equal(t, []string{"beta", "gamma", "alpha"}, podSummaryNames(memPage.Rows),
		"memory sort must be numeric live usage (1GB > 512MB > 128MB), not lexical")
}

func TestPodQueryCapabilitiesPublishMetricSorts(t *testing.T) {
	capabilities := podQueryCapabilities()
	require.Contains(t, capabilities.SortableFields, "cpu")
	require.Contains(t, capabilities.SortableFields, "memory")
}

func podSummaryNames(rows []PodSummary) []string {
	names := make([]string, len(rows))
	for i, r := range rows {
		names[i] = r.Name
	}
	return names
}

func TestWorkloadSnapshotOverlaysLiveUsageAtServe(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	replicas := int32(1)
	controller := true
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "web",
			Namespace:         "default",
			CreationTimestamp: metav1.NewTime(now.Add(-time.Hour)),
			ResourceVersion:   "21",
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
		},
	}
	ownedPod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "web-1",
			Namespace:         "default",
			CreationTimestamp: metav1.NewTime(now.Add(-time.Hour)),
			OwnerReferences: []metav1.OwnerReference{
				{Kind: "Deployment", APIVersion: "apps/v1", Name: "web", Controller: &controller},
			},
		},
		Status: corev1.PodStatus{Phase: corev1.PodRunning},
	}
	builder := &NamespaceWorkloadsBuilder{
		podIngest:           newFakePodWorkloadsIngestSource(ClusterMeta{}, nil, ownedPod),
		includePods:         true,
		workloadIngest:      newFakeWorkloadIngestSource(ClusterMeta{}, deployment),
		includeDeployments:  true,
		includeStatefulSets: true,
		includeDaemonSets:   true,
		includeJobs:         true,
		includeCronJobs:     true,
		metrics: fakeMetricsProvider{
			podUsage: map[string]metrics.PodUsage{
				"default/web-1": {CPUUsageMilli: 250, MemoryUsageBytes: 512 << 20, Timestamp: now},
			},
			metadata: metrics.Metadata{CollectedAt: now},
		},
	}
	seedWorkloadsFromBuilderSource(builder, ClusterMeta{})

	first, err := builder.Build(context.Background(), "namespace:default")
	require.NoError(t, err)
	payload := first.Payload.(NamespaceWorkloadsSnapshot)
	require.Len(t, payload.Rows, 1)
	require.Equal(t, "web", payload.Rows[0].Name)
	require.Equal(t, "250m", payload.Rows[0].CPUUsage)
	require.Equal(t, strconv.FormatInt(now.UnixNano(), 10), first.SourceVersions["metric"])
	require.False(t, payload.Metrics.Stale)

	// A metric tick advances only the metric source clock.
	builder.metrics = fakeMetricsProvider{
		podUsage: map[string]metrics.PodUsage{
			"default/web-1": {CPUUsageMilli: 300, Timestamp: now.Add(5 * time.Second)},
		},
		metadata: metrics.Metadata{CollectedAt: now.Add(5 * time.Second)},
	}
	second, err := builder.Build(context.Background(), "namespace:default")
	require.NoError(t, err)
	require.Equal(t, first.Version, second.Version)
	require.Equal(t, "300m", second.Payload.(NamespaceWorkloadsSnapshot).Rows[0].CPUUsage)
	require.Equal(t, strconv.FormatInt(now.Add(5*time.Second).UnixNano(), 10), second.SourceVersions["metric"])
}

func TestWorkloadQuerySortsByLiveUsage(t *testing.T) {
	items := []WorkloadSummary{
		{Kind: "Deployment", Name: "alpha", Namespace: "default", CPUUsage: "1000m", MemUsage: "128 MB"},
		{Kind: "Deployment", Name: "beta", Namespace: "default", CPUUsage: "650m", MemUsage: "1 GB"},
		{Kind: "Deployment", Name: "gamma", Namespace: "default", CPUUsage: "125m", MemUsage: "512 MB"},
	}

	_, cpuQuery, err := parseTypedTableQueryScope("c1", "namespace:default?sort=cpu&sortDirection=desc", namespaceWorkloadsDomainName, "rev-1")
	require.NoError(t, err)
	cpuPage := applyTypedTableQueryViaStore(items, cpuQuery, workloadTableQueryAdapter(), workloadsQuerypageSchema())
	require.Equal(t, []string{"alpha", "beta", "gamma"}, workloadSummaryNames(cpuPage.Rows),
		"cpu sort must be numeric live usage (1000 > 650 > 125), not lexical")

	_, memQuery, err := parseTypedTableQueryScope("c1", "namespace:default?sort=memory&sortDirection=desc", namespaceWorkloadsDomainName, "rev-1")
	require.NoError(t, err)
	memPage := applyTypedTableQueryViaStore(items, memQuery, workloadTableQueryAdapter(), workloadsQuerypageSchema())
	require.Equal(t, []string{"beta", "gamma", "alpha"}, workloadSummaryNames(memPage.Rows),
		"memory sort must be numeric live usage (1GB > 512MB > 128MB), not lexical")
}

func TestWorkloadQueryCapabilitiesPublishMetricSorts(t *testing.T) {
	builder := &NamespaceWorkloadsBuilder{}
	capabilities := builder.queryCapabilities()
	require.Contains(t, capabilities.SortableFields, "cpu")
	require.Contains(t, capabilities.SortableFields, "memory")
}

func workloadSummaryNames(rows []WorkloadSummary) []string {
	names := make([]string, len(rows))
	for i, r := range rows {
		names[i] = r.Name
	}
	return names
}
