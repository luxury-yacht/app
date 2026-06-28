package snapshot

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
	podres "github.com/luxury-yacht/app/backend/resources/pods"
	"github.com/luxury-yacht/app/backend/testsupport"
)

type fakePodMetricsProvider struct {
	usage    map[string]metrics.PodUsage
	metadata metrics.Metadata
}

func (f fakePodMetricsProvider) LatestNodeUsage() map[string]metrics.NodeUsage {
	return map[string]metrics.NodeUsage{}
}

func (f fakePodMetricsProvider) LatestPodUsage() map[string]metrics.PodUsage {
	out := make(map[string]metrics.PodUsage, len(f.usage))
	for k, v := range f.usage {
		out[k] = v
	}
	return out
}

func (f fakePodMetricsProvider) Metadata() metrics.Metadata {
	return f.metadata
}

// TestOverlayPodMetricsMissingSampleRendersNoData proves a row whose pod has NO
// metrics sample renders the no-data marker, never "0m"/"0Mi" — so "metrics
// unknown" is distinguishable from a real zero (Risk #9 / §3.6).
func TestOverlayPodMetricsMissingSampleRendersNoData(t *testing.T) {
	created := time.Date(2026, 6, 25, 9, 0, 0, 0, time.UTC)
	rows := []PodSummary{{
		Name:         "lonely",
		Namespace:    "default",
		AgeTimestamp: created.UnixMilli(),
	}}
	overlayPodMetrics(rows, map[string]metrics.PodUsage{}) // no sample for this pod

	require.Equal(t, streamrows.MetricsNoData, rows[0].CPUUsage)
	require.Equal(t, streamrows.MetricsNoData, rows[0].MemUsage)
}

// TestOverlayPodMetricsPresentSampleRendersNumbers proves a fresh sample (taken
// after the object's creation) overlays the formatted numbers.
func TestOverlayPodMetricsPresentSampleRendersNumbers(t *testing.T) {
	created := time.Date(2026, 6, 25, 9, 0, 0, 0, time.UTC)
	rows := []PodSummary{{
		Name:         "api",
		Namespace:    "default",
		AgeTimestamp: created.UnixMilli(),
	}}
	overlayPodMetrics(rows, map[string]metrics.PodUsage{
		"default/api": {CPUUsageMilli: 125, MemoryUsageBytes: 256 * 1024 * 1024, Timestamp: created.Add(30 * time.Second)},
	})

	require.Equal(t, "125m", rows[0].CPUUsage)
	require.Equal(t, "256 MB", rows[0].MemUsage)
}

// TestOverlayPodMetricsDropsStaleSampleFromPriorIncarnation is the Risk #9 / §3.6
// property test: a pod deleted and recreated under the SAME name (a new object with
// a LATER creationTimestamp) must NOT inherit the prior incarnation's numbers. A
// sample whose Timestamp predates the object's creation is dropped (renders no-data)
// until a fresh sample arrives. This expresses the "a metric cell's UID matches its
// object row's UID" invariant through the timestamp/recreate path (metrics-server
// exposes no UID; the sample-vs-creation timestamp comparison is the sound proxy).
func TestOverlayPodMetricsDropsStaleSampleFromPriorIncarnation(t *testing.T) {
	oldCreated := time.Date(2026, 6, 25, 9, 0, 0, 0, time.UTC)
	// The stale sample belongs to the FIRST incarnation, scraped before deletion.
	staleSample := metrics.PodUsage{
		CPUUsageMilli:    900,
		MemoryUsageBytes: 4 * 1024 * 1024 * 1024,
		Timestamp:        oldCreated.Add(time.Minute),
	}
	// The pod is recreated under the same name with a LATER creationTimestamp.
	newCreated := oldCreated.Add(time.Hour)
	rows := []PodSummary{{
		Name:         "churned",
		Namespace:    "default",
		AgeTimestamp: newCreated.UnixMilli(),
	}}

	overlayPodMetrics(rows, map[string]metrics.PodUsage{"default/churned": staleSample})

	// The recreated pod must NOT show the deleted pod's 900m / 4Gi numbers.
	require.NotEqual(t, "900m", rows[0].CPUUsage)
	require.Equal(t, streamrows.MetricsNoData, rows[0].CPUUsage)
	require.Equal(t, streamrows.MetricsNoData, rows[0].MemUsage)

	// Once a fresh sample (after the new creation) arrives, the numbers appear.
	freshSample := metrics.PodUsage{
		CPUUsageMilli:    50,
		MemoryUsageBytes: 128 * 1024 * 1024,
		Timestamp:        newCreated.Add(30 * time.Second),
	}
	overlayPodMetrics(rows, map[string]metrics.PodUsage{"default/churned": freshSample})
	require.Equal(t, "50m", rows[0].CPUUsage)
	require.Equal(t, "128 MB", rows[0].MemUsage)
}

func TestPodBuilderNodeScope(t *testing.T) {
	podA := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "pod-a",
			Namespace:         "default",
			CreationTimestamp: metav1.NewTime(time.Now().Add(-2 * time.Hour)),
			ResourceVersion:   "11",
			OwnerReferences: []metav1.OwnerReference{{
				APIVersion: "apps/v1",
				Kind:       "ReplicaSet",
				Name:       "rs-a",
				Controller: boolPtr(true),
			}},
		},
		Spec: corev1.PodSpec{
			NodeName: "node-1",
			Containers: []corev1.Container{{
				Name: "c1",
				Resources: corev1.ResourceRequirements{
					Requests: corev1.ResourceList{
						corev1.ResourceCPU:    resourceQuantity("100m"),
						corev1.ResourceMemory: resourceQuantity("128Mi"),
					},
					Limits: corev1.ResourceList{
						corev1.ResourceCPU:    resourceQuantity("200m"),
						corev1.ResourceMemory: resourceQuantity("256Mi"),
					},
				},
			}},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			ContainerStatuses: []corev1.ContainerStatus{{
				Name:         "c1",
				Ready:        true,
				RestartCount: 1,
			}},
		},
	}

	podB := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "pod-b",
			Namespace:         "kube-system",
			CreationTimestamp: metav1.NewTime(time.Now().Add(-30 * time.Minute)),
			ResourceVersion:   "15",
		},
		Spec: corev1.PodSpec{
			NodeName: "node-1",
			Containers: []corev1.Container{{
				Name:      "c1",
				Resources: corev1.ResourceRequirements{},
			}},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodPending,
		},
	}

	rs := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "rs-a",
			Namespace: "default",
			OwnerReferences: []metav1.OwnerReference{{
				APIVersion: "apps/v1",
				Kind:       "Deployment",
				Name:       "deploy-a",
				Controller: boolPtr(true),
			}},
		},
		Spec: appsv1.ReplicaSetSpec{},
	}

	collectedAt := time.Now().Add(-10 * time.Second)
	builder := &PodBuilder{
		podLister: testsupport.NewPodLister(t, podA, podB),
		rsLister:  testsupport.NewReplicaSetLister(t, rs),
		metrics: fakePodMetricsProvider{
			usage: map[string]metrics.PodUsage{
				"default/pod-a": {
					CPUUsageMilli:    150,
					MemoryUsageBytes: 196 * 1024 * 1024,
				},
			},
			metadata: metrics.Metadata{
				CollectedAt:         collectedAt,
				SuccessCount:        5,
				FailureCount:        1,
				LastError:           "",
				ConsecutiveFailures: 0,
			},
		},
	}

	snapshot, err := builder.Build(context.Background(), "node:node-1")
	require.NoError(t, err)
	require.Equal(t, podDomainName, snapshot.Domain)
	require.Equal(t, "node:node-1", snapshot.Scope)
	require.Equal(t, uint64(15), snapshot.Version)

	payload, ok := snapshot.Payload.(PodSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Rows, 2)

	first := payload.Rows[0]
	require.Equal(t, "pod-a", first.Name)
	require.Equal(t, "Deployment", first.OwnerKind)
	require.Equal(t, "deploy-a", first.OwnerName)
	require.Equal(t, "apps/v1", first.OwnerAPIVersion, "ReplicaSet→Deployment collapse must produce apps/v1")
	require.Equal(t, "150m", first.CPUUsage)
	require.Equal(t, "196 MB", first.MemUsage)
	require.True(t, strings.HasPrefix(first.Ready, "1/"))

	require.False(t, payload.Metrics.Stale)
	require.Equal(t, uint64(5), payload.Metrics.SuccessCount)
	require.Equal(t, uint64(1), payload.Metrics.FailureCount)
}

func TestPodBuilderWorkloadScope(t *testing.T) {
	owner := boolPtr(true)
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "pod-workload",
			Namespace:         "prod",
			CreationTimestamp: metav1.NewTime(time.Now().Add(-1 * time.Hour)),
			ResourceVersion:   "7",
			OwnerReferences: []metav1.OwnerReference{{
				APIVersion: "apps/v1",
				Kind:       "ReplicaSet",
				Name:       "rs-workload",
				Controller: owner,
			}},
		},
		Spec: corev1.PodSpec{
			NodeName: "node-x",
			Containers: []corev1.Container{{
				Name:      "c1",
				Resources: corev1.ResourceRequirements{},
			}},
		},
	}
	rs := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "rs-workload",
			Namespace: "prod",
			OwnerReferences: []metav1.OwnerReference{{
				APIVersion: "apps/v1",
				Kind:       "Deployment",
				Name:       "orders",
				Controller: owner,
			}},
		},
	}

	builder := &PodBuilder{
		podLister: testsupport.NewPodLister(t, pod),
		rsLister:  testsupport.NewReplicaSetLister(t, rs),
		metrics:   fakePodMetricsProvider{},
	}

	snapshot, err := builder.Build(context.Background(), "workload:prod:apps:v1:Deployment:orders")
	require.NoError(t, err)
	require.Equal(t, uint64(7), snapshot.Version)

	payload, ok := snapshot.Payload.(PodSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Rows, 1)
	require.Equal(t, "pod-workload", payload.Rows[0].Name)
	require.Equal(t, "Deployment", payload.Rows[0].OwnerKind)
	require.Equal(t, "orders", payload.Rows[0].OwnerName)
	require.Equal(t, "apps/v1", payload.Rows[0].OwnerAPIVersion)
}

func TestParseWorkloadScopeRejectsMissingIdentitySegments(t *testing.T) {
	for _, value := range []string{
		":apps:v1:Deployment:orders",
		"prod::v1:Deployment:orders",
		"prod:apps::Deployment:orders",
		"prod:apps:v1::orders",
		"prod:apps:v1:Deployment:",
	} {
		t.Run(value, func(t *testing.T) {
			_, err := parseWorkloadScope(value)
			require.ErrorContains(t, err, "invalid workload scope")
		})
	}
}

// TestResolvePodOwnerThreadsCRDOwnerAPIVersion verifies that the snapshot
// pod resolver passes through owner.APIVersion verbatim for CRD-as-Pod-
// owner targets (Argo Rollout, KubeVirt VirtualMachineInstance, Tekton
// TaskRun, Spark SparkApplication, etc). Without this the panel cannot
// open the owner with a fully-qualified GVK and the strict object-YAML
// path hard-fails.
func TestPodBuilderNamespaceScope(t *testing.T) {
	now := time.Now()
	podA := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "team-a-pod-1",
			Namespace:         "team-a",
			ResourceVersion:   "101",
			CreationTimestamp: metav1.NewTime(now.Add(-15 * time.Minute)),
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{
				Name: "web",
				Resources: corev1.ResourceRequirements{
					Requests: corev1.ResourceList{
						corev1.ResourceCPU:    resourceQuantity("50m"),
						corev1.ResourceMemory: resourceQuantity("64Mi"),
					},
				},
			}},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			ContainerStatuses: []corev1.ContainerStatus{{
				Name:         "web",
				Ready:        true,
				RestartCount: 0,
			}},
		},
	}

	podB := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "team-a-pod-2",
			Namespace:         "team-a",
			ResourceVersion:   "95",
			CreationTimestamp: metav1.NewTime(now.Add(-5 * time.Minute)),
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{
				Name: "worker",
				Resources: corev1.ResourceRequirements{
					Limits: corev1.ResourceList{
						corev1.ResourceCPU:    resourceQuantity("150m"),
						corev1.ResourceMemory: resourceQuantity("128Mi"),
					},
				},
			}},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodPending,
		},
	}

	builder := &PodBuilder{
		podLister: testsupport.NewPodLister(t, podA, podB),
		rsLister:  testsupport.NewReplicaSetLister(t),
		metrics: fakePodMetricsProvider{
			usage: map[string]metrics.PodUsage{
				"team-a/team-a-pod-1": {
					CPUUsageMilli:    25,
					MemoryUsageBytes: 32 * 1024 * 1024,
				},
			},
			metadata: metrics.Metadata{
				CollectedAt: now,
			},
		},
	}

	snapshot, err := builder.Build(context.Background(), "namespace:team-a")
	require.NoError(t, err)
	require.Equal(t, podDomainName, snapshot.Domain)
	require.Equal(t, "namespace:team-a", snapshot.Scope)
	require.Equal(t, uint64(101), snapshot.Version)

	payload, ok := snapshot.Payload.(PodSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Rows, 2)
	require.Equal(t, "team-a", payload.Rows[0].Namespace)
	require.Equal(t, "team-a-pod-1", payload.Rows[0].Name)
	require.Equal(t, "25m", payload.Rows[0].CPUUsage)
	require.Equal(t, "32 MB", payload.Rows[0].MemUsage)
	require.Equal(t, "team-a-pod-2", payload.Rows[1].Name)
}

func TestPodBuilderMetricRefreshDoesNotChangeSnapshotVersion(t *testing.T) {
	now := time.Unix(1000, 0)
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "api",
			Namespace:         "team-a",
			ResourceVersion:   "101",
			CreationTimestamp: metav1.NewTime(now.Add(-time.Minute)),
		},
		Status: corev1.PodStatus{Phase: corev1.PodRunning},
	}
	builder := &PodBuilder{
		podLister: testsupport.NewPodLister(t, pod),
		rsLister:  testsupport.NewReplicaSetLister(t),
		metrics: fakePodMetricsProvider{
			usage: map[string]metrics.PodUsage{
				"team-a/api": {CPUUsageMilli: 25, MemoryUsageBytes: 32 * 1024 * 1024},
			},
			metadata: metrics.Metadata{CollectedAt: now},
		},
	}

	first, err := builder.Build(context.Background(), "namespace:team-a")
	require.NoError(t, err)
	require.Equal(t, uint64(101), first.Version)
	require.Equal(t, "25m", first.Payload.(PodSnapshot).Rows[0].CPUUsage)

	builder.metrics = fakePodMetricsProvider{
		usage: map[string]metrics.PodUsage{
			"team-a/api": {CPUUsageMilli: 75, MemoryUsageBytes: 64 * 1024 * 1024},
		},
		metadata: metrics.Metadata{CollectedAt: now.Add(5 * time.Second)},
	}

	second, err := builder.Build(context.Background(), "namespace:team-a")
	require.NoError(t, err)
	require.Equal(t, first.Version, second.Version)
	require.Equal(t, "75m", second.Payload.(PodSnapshot).Rows[0].CPUUsage)
}

func benchmarkPods(tb testing.TB, n int) ([]*corev1.Pod, map[string]metrics.PodUsage, time.Time) {
	tb.Helper()
	now := time.Now()
	pods := make([]*corev1.Pod, n)
	usage := map[string]metrics.PodUsage{}
	for i := 0; i < n; i++ {
		name := fmt.Sprintf("pod-%05d", i)
		ns := fmt.Sprintf("team-%d", i%50)
		pods[i] = &corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Name:              name,
				Namespace:         ns,
				UID:               types.UID(name),
				ResourceVersion:   fmt.Sprintf("%d", i),
				CreationTimestamp: metav1.NewTime(now.Add(-time.Duration(i) * time.Second)),
				OwnerReferences:   []metav1.OwnerReference{{Kind: "ReplicaSet", Name: "rs-" + name, Controller: ptrBool(true)}},
			},
			Spec: corev1.PodSpec{
				NodeName: fmt.Sprintf("node-%d", i%100),
				Containers: []corev1.Container{{
					Name: "c",
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
				ContainerStatuses: []corev1.ContainerStatus{{Name: "c", Ready: true, RestartCount: int32(i % 5)}},
			},
		}
		usage[ns+"/"+name] = metrics.PodUsage{CPUUsageMilli: int64(i % 500), MemoryUsageBytes: int64(i) * 1024 * 1024}
	}
	return pods, usage, now
}

// BenchmarkPodBuilderBuildCold measures one full query build (project every pod)
// for a large scope — the cold-open / cache-miss cost we'd target with an index.
func BenchmarkPodBuilderBuildCold(b *testing.B) {
	pods, usage, now := benchmarkPods(b, 10000)
	builder := &PodBuilder{
		podLister: testsupport.NewPodLister(b, pods...),
		rsLister:  testsupport.NewReplicaSetLister(b),
		metrics:   fakePodMetricsProvider{usage: usage, metadata: metrics.Metadata{CollectedAt: now}},
	}
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "c1", ClusterName: "cluster"})
	scope := "namespace:all?limit=50&sort=name&sortDirection=asc"
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := builder.Build(ctx, scope); err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkPodBuilderBuildWarm measures a refetch when nothing changed — the
// memo cache should reuse projections (the busy-cluster steady state).
func BenchmarkPodBuilderBuildWarm(b *testing.B) {
	pods, usage, now := benchmarkPods(b, 10000)
	builder := newPodBuilder(testsupport.NewPodLister(b, pods...), nil, testsupport.NewReplicaSetLister(b), fakePodMetricsProvider{usage: usage, metadata: metrics.Metadata{CollectedAt: now}})
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "c1", ClusterName: "cluster"})
	scope := "namespace:all?limit=50&sort=name&sortDirection=asc"
	if _, err := builder.Build(ctx, scope); err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := builder.Build(ctx, scope); err != nil {
			b.Fatal(err)
		}
	}
}

func TestPodBuilderReusesProjectionsAcrossBuilds(t *testing.T) {
	now := time.Now()
	mkPod := func(name string) *corev1.Pod {
		return &corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Name:              name,
				Namespace:         "team-a",
				UID:               types.UID(name + "-uid"),
				ResourceVersion:   "1",
				CreationTimestamp: metav1.NewTime(now),
			},
			Status: corev1.PodStatus{Phase: corev1.PodRunning},
		}
	}
	builder := newPodBuilder(
		testsupport.NewPodLister(t, mkPod("a"), mkPod("b")),
		nil,
		testsupport.NewReplicaSetLister(t),
		fakePodMetricsProvider{metadata: metrics.Metadata{CollectedAt: now}},
	)
	projections := 0
	builder.buildSummary = func(meta ClusterMeta, pod *corev1.Pod, cpu, mem int64, rsMap map[string]string) PodSummary {
		projections++
		return podres.BuildStreamSummaryFromRSMap(meta, pod, cpu, mem, rsMap)
	}

	first, err := builder.Build(context.Background(), "namespace:team-a")
	require.NoError(t, err)
	require.Equal(t, 2, projections, "cold build projects every pod once")

	second, err := builder.Build(context.Background(), "namespace:team-a")
	require.NoError(t, err)
	// Unchanged pods + unchanged metrics revision → cached projections reused; the
	// busy-cluster refetch no longer re-projects every pod.
	require.Equal(t, 2, projections, "warm build reuses cached projections")

	require.Equal(t, first.Payload.(PodSnapshot).Rows, second.Payload.(PodSnapshot).Rows)
}

func TestPodBuilderReportsScopeCounts(t *testing.T) {
	now := time.Now()
	healthy := func(name string) *corev1.Pod {
		return &corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Name:              name,
				Namespace:         "team-a",
				ResourceVersion:   "1",
				CreationTimestamp: metav1.NewTime(now),
			},
			Status: corev1.PodStatus{
				Phase:             corev1.PodRunning,
				ContainerStatuses: []corev1.ContainerStatus{{Name: "c", Ready: true}},
			},
		}
	}
	evicted := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "evicted",
			Namespace:         "team-a",
			ResourceVersion:   "2",
			CreationTimestamp: metav1.NewTime(now),
		},
		Status: corev1.PodStatus{Phase: corev1.PodFailed, Reason: "Evicted"},
	}

	builder := &PodBuilder{
		podLister: testsupport.NewPodLister(t, healthy("ok-1"), healthy("ok-2"), evicted),
		rsLister:  testsupport.NewReplicaSetLister(t),
		metrics:   fakePodMetricsProvider{metadata: metrics.Metadata{CollectedAt: now}},
	}

	snapshot, err := builder.Build(context.Background(), "namespace:team-a")
	require.NoError(t, err)
	payload, ok := snapshot.Payload.(PodSnapshot)
	require.True(t, ok)

	// Scope-level counts travel on the payload so a query-backed (signal-only)
	// view can show unhealthy/total badges without retaining the live row set.
	require.Equal(t, 3, payload.TotalCount)
	require.Equal(t, 1, payload.HealthCounts["unhealthy"])
	require.Equal(t, 0, payload.HealthCounts["restarts"])
	require.Equal(t, 0, payload.HealthCounts["not-ready"])
}

func TestPodBuilderAllNamespacesScope(t *testing.T) {
	now := time.Now()
	podA := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "alpha",
			Namespace:         "team-a",
			ResourceVersion:   "20",
			CreationTimestamp: metav1.NewTime(now.Add(-20 * time.Minute)),
		},
	}
	podB := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "bravo",
			Namespace:         "team-b",
			ResourceVersion:   "25",
			CreationTimestamp: metav1.NewTime(now.Add(-10 * time.Minute)),
		},
	}

	builder := &PodBuilder{
		podLister: testsupport.NewPodLister(t, podA, podB),
		rsLister:  testsupport.NewReplicaSetLister(t),
		metrics: fakePodMetricsProvider{
			usage: map[string]metrics.PodUsage{},
			metadata: metrics.Metadata{
				CollectedAt: now,
			},
		},
	}

	snapshot, err := builder.Build(context.Background(), "namespace:all")
	require.NoError(t, err)
	require.Equal(t, podDomainName, snapshot.Domain)
	require.Equal(t, "namespace:all", snapshot.Scope)
	require.Equal(t, uint64(25), snapshot.Version)

	payload, ok := snapshot.Payload.(PodSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Rows, 2)
	require.Equal(t, []string{"team-a", "team-b"}, []string{payload.Rows[0].Namespace, payload.Rows[1].Namespace})
}

func TestPodBuilderAllNamespacesQuerySortsFiltersAndPagesByMetrics(t *testing.T) {
	now := time.Now()
	pods := []*corev1.Pod{
		{
			ObjectMeta: metav1.ObjectMeta{
				Name:              "alpha",
				Namespace:         "team-a",
				ResourceVersion:   "20",
				CreationTimestamp: metav1.NewTime(now.Add(-20 * time.Minute)),
			},
		},
		{
			ObjectMeta: metav1.ObjectMeta{
				Name:              "bravo",
				Namespace:         "team-b",
				ResourceVersion:   "25",
				CreationTimestamp: metav1.NewTime(now.Add(-10 * time.Minute)),
			},
		},
		{
			ObjectMeta: metav1.ObjectMeta{
				Name:              "charlie",
				Namespace:         "team-b",
				ResourceVersion:   "26",
				CreationTimestamp: metav1.NewTime(now.Add(-5 * time.Minute)),
			},
		},
	}

	builder := &PodBuilder{
		podLister: testsupport.NewPodLister(t, pods...),
		rsLister:  testsupport.NewReplicaSetLister(t),
		metrics: fakePodMetricsProvider{
			usage: map[string]metrics.PodUsage{
				"team-a/alpha":   {CPUUsageMilli: 25},
				"team-b/bravo":   {CPUUsageMilli: 300},
				"team-b/charlie": {CPUUsageMilli: 100},
			},
			metadata: metrics.Metadata{CollectedAt: now},
		},
	}

	snapshot, err := builder.Build(context.Background(), "cluster-a|namespace:all?namespaces=team-b&sort=cpu&sortDirection=desc&limit=1")
	require.NoError(t, err)
	payload := snapshot.Payload.(PodSnapshot)
	require.Equal(t, 2, payload.Total)
	require.True(t, payload.TotalIsExact)
	require.Equal(t, []string{"team-b"}, payload.Namespaces)
	require.Equal(t, []string{"Pod"}, payload.Kinds)
	require.Len(t, payload.Rows, 1)
	require.Equal(t, "bravo", payload.Rows[0].Name)
	require.NotEmpty(t, payload.Continue)

	next, err := builder.Build(context.Background(), "cluster-a|namespace:all?namespaces=team-b&sort=cpu&sortDirection=desc&limit=1&continue="+payload.Continue)
	require.NoError(t, err)
	nextPayload := next.Payload.(PodSnapshot)
	require.Len(t, nextPayload.Rows, 1)
	require.Equal(t, "charlie", nextPayload.Rows[0].Name)
	require.Empty(t, nextPayload.Continue)
}

func TestPodBuilderAllNamespacesMetricCursorContinuesAcrossMetricsRefresh(t *testing.T) {
	now := time.Now()
	pods := []*corev1.Pod{
		{
			ObjectMeta: metav1.ObjectMeta{
				Name:              "bravo",
				Namespace:         "team-b",
				ResourceVersion:   "25",
				CreationTimestamp: metav1.NewTime(now.Add(-10 * time.Minute)),
			},
		},
		{
			ObjectMeta: metav1.ObjectMeta{
				Name:              "charlie",
				Namespace:         "team-b",
				ResourceVersion:   "26",
				CreationTimestamp: metav1.NewTime(now.Add(-5 * time.Minute)),
			},
		},
	}

	builder := &PodBuilder{
		podLister: testsupport.NewPodLister(t, pods...),
		rsLister:  testsupport.NewReplicaSetLister(t),
		metrics: fakePodMetricsProvider{
			usage: map[string]metrics.PodUsage{
				"team-b/bravo":   {CPUUsageMilli: 300},
				"team-b/charlie": {CPUUsageMilli: 100},
			},
			metadata: metrics.Metadata{CollectedAt: now},
		},
	}

	first, err := builder.Build(context.Background(), "cluster-a|namespace:all?sort=cpu&sortDirection=desc&limit=1")
	require.NoError(t, err)
	firstPayload := first.Payload.(PodSnapshot)
	require.Len(t, firstPayload.Rows, 1)
	require.Equal(t, "bravo", firstPayload.Rows[0].Name)
	require.NotEmpty(t, firstPayload.Continue)

	builder.metrics = fakePodMetricsProvider{
		usage: map[string]metrics.PodUsage{
			"team-b/bravo":   {CPUUsageMilli: 320},
			"team-b/charlie": {CPUUsageMilli: 110},
		},
		metadata: metrics.Metadata{CollectedAt: now.Add(5 * time.Second)},
	}

	next, err := builder.Build(context.Background(), "cluster-a|namespace:all?sort=cpu&sortDirection=desc&limit=1&continue="+firstPayload.Continue)
	require.NoError(t, err)
	nextPayload := next.Payload.(PodSnapshot)
	require.False(t, nextPayload.CursorInvalid)
	require.Len(t, nextPayload.Rows, 1)
	require.Equal(t, "charlie", nextPayload.Rows[0].Name)
	require.Empty(t, nextPayload.Continue)
}

func boolPtr(v bool) *bool {
	return &v
}

func resourceQuantity(value string) resource.Quantity {
	return resource.MustParse(value)
}
