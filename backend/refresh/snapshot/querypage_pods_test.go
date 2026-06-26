package snapshot

import (
	"context"
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
	podres "github.com/luxury-yacht/app/backend/resources/pods"
	"github.com/luxury-yacht/app/backend/testsupport"
)

// makePodRows builds varied PodSummary rows. It sets every field the adapter
// sorts/searches/predicates on (name, namespace, status, ready, restarts, owner,
// node, age) plus the metrics-overlay fields (CPUUsage/MemUsage) as already-
// formatted strings, with deliberate ties, so the equivalence matrix below exercises
// numeric (cpu/memory/restarts/ready/age) and string sorts plus the health predicate.
func makePodRows(n int) []PodSummary {
	namespaces := []string{"default", "kube-system", "app"}
	statuses := []string{"Running", "Pending", "Completed", "CrashLoopBackOff"}
	presentations := []string{"healthy", "warning", "error", "not-ready", "terminating"}
	owners := []string{"deploy-a", "deploy-b", "None"}
	nodes := []string{"node-1", "node-2", "node-3"}
	cpus := []string{"0m", "100m", "245m", "1000m"}
	mems := []string{"0Mi", "64 MB", "256 MB", "1.5 GB"}
	rows := make([]PodSummary, n)
	for i := 0; i < n; i++ {
		ready := i % 4
		total := ready
		if i%3 == 0 {
			total = ready + 1 // some not-ready pairs
		}
		rows[i] = PodSummary{
			Name:               fmt.Sprintf("pod-%03d", i), // unique -> unique row key
			Namespace:          namespaces[i%len(namespaces)],
			Status:             statuses[i%len(statuses)],
			StatusPresentation: presentations[i%len(presentations)],
			Ready:              fmt.Sprintf("%d/%d", ready, total),
			Restarts:           int32((i * 7) % 5), // many zeros and non-zeros
			OwnerKind:          "Deployment",
			OwnerName:          owners[i%len(owners)],
			Node:               nodes[i%len(nodes)],
			Age:                fmt.Sprintf("%dm", i%5),
			AgeTimestamp:       int64(1_000_000 + (i%9)*1000), // ties, non-zero so NumericSort engages
			CPUUsage:           cpus[i%len(cpus)],
			MemUsage:           mems[i%len(mems)],
		}
	}
	return rows
}

// TestPodsQueryViaStoreEquivalent is the pods cutover gate: the engine-backed serve
// path must produce the SAME page as the live applyTypedTableQuery — identical rows
// across full pagination, totals, and facet value lists — across a matrix of sorts
// (including cpu and memory) × directions × namespace/kind filters × searches AND
// health-predicate queries.
func TestPodsQueryViaStoreEquivalent(t *testing.T) {
	adapter := podTableQueryAdapter()
	items := makePodRows(250)

	paginate := func(serve func(typedTableQuery) typedTableQueryPage[PodSummary], base typedTableQuery) ([]string, typedTableQueryPage[PodSummary]) {
		q := base
		var keys []string
		var first typedTableQueryPage[PodSummary]
		for i := 0; ; i++ {
			if i > 1000 {
				t.Fatal("pagination did not terminate")
			}
			page := serve(q)
			if i == 0 {
				first = page
			}
			for _, r := range page.Rows {
				keys = append(keys, adapter.Key(r))
			}
			if page.Continue == "" {
				break
			}
			q.Request.Continue = page.Continue
		}
		return keys, first
	}

	type filt struct {
		ns         []string
		kinds      []string
		search     string
		predicates []ResourceQueryPredicate
	}
	sorts := []string{"", "name", "namespace", "status", "ready", "restarts", "owner", "node", "cpu", "memory", "age"}
	dirs := []string{"asc", "desc"}
	filts := []filt{
		{},
		{ns: []string{"default"}},
		{ns: []string{"default", "app"}},
		{kinds: []string{"Pod"}},
		{ns: []string{"kube-system"}, kinds: []string{"Pod"}},
		{search: "pod-01"},
		{search: "running"},
		{predicates: []ResourceQueryPredicate{{Field: "health", Value: "restarts"}}},
		{predicates: []ResourceQueryPredicate{{Field: "health", Value: "not-ready"}}},
		{predicates: []ResourceQueryPredicate{{Field: "health", Value: "unhealthy"}}},
		{ns: []string{"default"}, predicates: []ResourceQueryPredicate{{Field: "health", Value: "restarts"}}},
	}

	for _, sf := range sorts {
		for _, d := range dirs {
			for _, f := range filts {
				base := typedTableQuery{
					Enabled: true,
					Request: ResourceQueryRequest{
						ClusterID: "c", SortField: sf, SortDirection: d, Limit: 17,
						Namespaces: f.ns, Kinds: f.kinds, Search: f.search, Predicates: f.predicates,
					},
				}
				liveKeys, liveFirst := paginate(func(q typedTableQuery) typedTableQueryPage[PodSummary] {
					return applyTypedTableQuery(items, q, adapter)
				}, base)
				engineKeys, engineFirst := paginate(func(q typedTableQuery) typedTableQueryPage[PodSummary] {
					return applyTypedTableQueryViaStore(items, q, adapter, podQuerypageSchema())
				}, base)

				label := fmt.Sprintf("sort=%q dir=%s ns=%v kinds=%v search=%q preds=%v", sf, d, f.ns, f.kinds, f.search, f.predicates)
				if !slices.Equal(liveKeys, engineKeys) {
					t.Fatalf("%s: row sequence differs (live=%d engine=%d rows)", label, len(liveKeys), len(engineKeys))
				}
				if liveFirst.Total != engineFirst.Total {
					t.Fatalf("%s: total live=%d engine=%d", label, liveFirst.Total, engineFirst.Total)
				}
				if liveFirst.UnfilteredTotal != engineFirst.UnfilteredTotal {
					t.Fatalf("%s: unfilteredTotal live=%d engine=%d", label, liveFirst.UnfilteredTotal, engineFirst.UnfilteredTotal)
				}
				if !slices.Equal(liveFirst.Namespaces, engineFirst.Namespaces) {
					t.Fatalf("%s: namespace facets live=%v engine=%v", label, liveFirst.Namespaces, engineFirst.Namespaces)
				}
				if !slices.Equal(liveFirst.Kinds, engineFirst.Kinds) {
					t.Fatalf("%s: kind facets live=%v engine=%v", label, liveFirst.Kinds, engineFirst.Kinds)
				}
			}
		}
	}
}

// TestPodMaintainedIngestOverlayMatchesProject proves that zeroed-metric ingest
// into the store followed by a serve-time metrics overlay yields a PodSummary
// identical, field-for-field, to the live projection that builds the row with the
// real cpu/mem values inline. This is the correctness precondition for keeping
// metrics OUTSIDE the store.
func TestPodMaintainedIngestOverlayMatchesProject(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster"}
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "api-0",
			Namespace:         "default",
			ResourceVersion:   "42",
			CreationTimestamp: metav1.NewTime(time.Now().Add(-90 * time.Minute)),
			OwnerReferences: []metav1.OwnerReference{{
				APIVersion: "apps/v1",
				Kind:       "ReplicaSet",
				Name:       "rs-api",
				Controller: boolPtr(true),
			}},
		},
		Spec: corev1.PodSpec{
			NodeName: "node-7",
			Containers: []corev1.Container{{
				Name: "c1",
				Resources: corev1.ResourceRequirements{
					Requests: corev1.ResourceList{
						corev1.ResourceCPU:    resourceQuantity("100m"),
						corev1.ResourceMemory: resourceQuantity("128Mi"),
					},
				},
			}},
		},
		Status: corev1.PodStatus{
			Phase:             corev1.PodRunning,
			ContainerStatuses: []corev1.ContainerStatus{{Name: "c1", Ready: true, RestartCount: 2}},
		},
	}
	rs := testsupport.NewReplicaSetLister(t)

	const cpuMilli, memBytes = int64(245), int64(256 * 1024 * 1024)

	// OLD: project the row with the real metrics inline.
	live := podres.BuildStreamSummary(meta, pod, cpuMilli, memBytes, rs)

	// NEW: project with metrics ZEROED (what the informer feeds the store), then
	// overlay the same metrics at serve time exactly as the maintained serve path does.
	stored := podres.BuildStreamSummary(meta, pod, 0, 0, rs)
	stored.CPUUsage = streamrows.FormatCPUMilli(cpuMilli)
	stored.MemUsage = streamrows.FormatMemoryBytes(memBytes)

	require.Equal(t, live, stored, "zeroed ingest + serve overlay must equal live projection")
}

// TestPodBuilderMaintainedStoreServesNamespaceScopeWithFreshMetrics drives the
// actual maintained-store serve path: a builder whose store holds zeroed-metric
// rows must serve a namespace scope from RAM (no lister), overlaying the FRESH
// metrics sample at serve. Re-serving after the metrics change must reflect the new
// values without re-ingesting — proving metrics are NOT stored.
func TestPodBuilderMaintainedStoreServesNamespaceScopeWithFreshMetrics(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster"}
	now := time.Now()
	mkPod := func(name string) *corev1.Pod {
		return &corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Name:              name,
				Namespace:         "team-a",
				ResourceVersion:   "5",
				CreationTimestamp: metav1.NewTime(now),
			},
			Status: corev1.PodStatus{
				Phase:             corev1.PodRunning,
				ContainerStatuses: []corev1.ContainerStatus{{Name: "c", Ready: true}},
			},
		}
	}

	maintained := newTypedMaintainedStore(meta, podQuerypageSchema(), podTableQueryAdapter())
	rs := testsupport.NewReplicaSetLister(t)
	for _, p := range []*corev1.Pod{mkPod("alpha"), mkPod("bravo")} {
		// Ingest the row with metrics ZEROED, exactly as the informer handler does.
		maintained.upsertRow(podres.BuildStreamSummary(meta, p, 0, 0, rs), p)
	}

	builder := &PodBuilder{
		// No podLister: the namespace scope must be served entirely from the store.
		rsLister:   rs,
		maintained: maintained,
		metrics: fakePodMetricsProvider{
			usage: map[string]metrics.PodUsage{
				"team-a/alpha": {CPUUsageMilli: 245, MemoryUsageBytes: 256 * 1024 * 1024},
			},
			metadata: metrics.Metadata{CollectedAt: now},
		},
	}
	ctx := WithClusterMeta(context.Background(), meta)

	snap, err := builder.Build(ctx, "namespace:team-a")
	require.NoError(t, err)
	require.Equal(t, fmt.Sprintf("%d", now.UnixNano()), snap.SourceVersions["metric"])
	payload := snap.Payload.(PodSnapshot)
	require.Len(t, payload.Rows, 2)
	require.Equal(t, "alpha", payload.Rows[0].Name)
	require.Equal(t, "245m", payload.Rows[0].CPUUsage, "fresh metrics overlaid at serve")
	require.Equal(t, "256 MB", payload.Rows[0].MemUsage)
	require.Equal(t, streamrows.MetricsNoData, payload.Rows[1].CPUUsage, "no metrics sample -> no-data marker, never 0 (Risk #9 / §3.6)")
	require.Equal(t, streamrows.MetricsNoData, payload.Rows[1].MemUsage)
	require.Equal(t, 2, payload.TotalCount)

	// Change ONLY the metrics sample (no re-ingest) and re-serve. The new value must
	// appear, proving metrics live outside the store.
	builder.metrics = fakePodMetricsProvider{
		usage: map[string]metrics.PodUsage{
			"team-a/alpha": {CPUUsageMilli: 999, MemoryUsageBytes: 512 * 1024 * 1024},
		},
		metadata: metrics.Metadata{CollectedAt: now.Add(time.Second)},
	}
	snap2, err := builder.Build(ctx, "namespace:team-a")
	require.NoError(t, err)
	require.Equal(t, fmt.Sprintf("%d", now.Add(time.Second).UnixNano()), snap2.SourceVersions["metric"])
	require.Equal(t, "999m", snap2.Payload.(PodSnapshot).Rows[0].CPUUsage, "metrics refreshed without re-ingest")
}
