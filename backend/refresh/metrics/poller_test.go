package metrics

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/util/flowcontrol"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"

	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

func TestPollerRefreshSuccess(t *testing.T) {
	t.Helper()

	ctx := context.Background()

	nodeList := &metricsv1beta1.NodeMetricsList{
		Items: []metricsv1beta1.NodeMetrics{{
			ObjectMeta: metav1.ObjectMeta{Name: "node-a"},
			Usage: corev1.ResourceList{
				corev1.ResourceCPU:    *resource.NewMilliQuantity(250, resource.DecimalSI),
				corev1.ResourceMemory: *resource.NewQuantity(512*1024*1024, resource.BinarySI),
			},
		}},
	}

	podList := &metricsv1beta1.PodMetricsList{
		Items: []metricsv1beta1.PodMetrics{{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "api-0",
				Namespace: "default",
			},
			Containers: []metricsv1beta1.ContainerMetrics{{
				Name: "api",
				Usage: corev1.ResourceList{
					corev1.ResourceCPU:    *resource.NewMilliQuantity(125, resource.DecimalSI),
					corev1.ResourceMemory: *resource.NewQuantity(256*1024*1024, resource.BinarySI),
				},
			}},
		}},
	}

	recorder := telemetry.NewRecorder()
	poller := NewPoller(nil, nil, time.Second, recorder)
	poller.client = &metricsclient.Clientset{}
	poller.rateLimiter = flowcontrol.NewFakeAlwaysRateLimiter()
	poller.maxRetry = 1
	poller.maxBackoff = time.Millisecond
	poller.jitterFactor = 0

	poller.nodeLister = func(context.Context, *metricsclient.Clientset) (*metricsv1beta1.NodeMetricsList, error) {
		return nodeList, nil
	}
	poller.podLister = func(context.Context, *metricsclient.Clientset) (*metricsv1beta1.PodMetricsList, error) {
		return podList, nil
	}

	require.NoError(t, poller.refresh(ctx))

	nodes := poller.LatestNodeUsage()
	require.Equal(t, NodeUsage{CPUUsageMilli: 250, MemoryUsageBytes: 512 * 1024 * 1024}, nodes["node-a"])

	pods := poller.LatestPodUsage()
	require.Equal(t, PodUsage{CPUUsageMilli: 125, MemoryUsageBytes: 256 * 1024 * 1024}, pods["default/api-0"])

	meta := poller.Metadata()
	require.Equal(t, uint64(1), meta.SuccessCount)
	require.Equal(t, 0, meta.ConsecutiveFailures)
	require.Empty(t, meta.LastError)
	require.False(t, meta.CollectedAt.IsZero())

	summary := recorder.SnapshotSummary()
	require.Equal(t, uint64(1), summary.Metrics.SuccessCount)
	require.Zero(t, summary.Metrics.ConsecutiveFailures)
	require.Empty(t, summary.Metrics.LastError)
}

// Every collection attempt must notify the observer because both fresh samples
// and failure metadata are user-visible and advance the metric source revision.
func TestPollerNotifiesObserverAfterSuccessfulCollection(t *testing.T) {
	ctx := context.Background()

	nodeList := &metricsv1beta1.NodeMetricsList{
		Items: []metricsv1beta1.NodeMetrics{{
			ObjectMeta: metav1.ObjectMeta{Name: "node-a"},
			Usage: corev1.ResourceList{
				corev1.ResourceCPU:    *resource.NewMilliQuantity(250, resource.DecimalSI),
				corev1.ResourceMemory: *resource.NewQuantity(512*1024*1024, resource.BinarySI),
			},
		}},
	}
	podList := &metricsv1beta1.PodMetricsList{}

	poller := NewPoller(nil, nil, time.Second, telemetry.NewRecorder())
	poller.client = &metricsclient.Clientset{}
	poller.rateLimiter = flowcontrol.NewFakeAlwaysRateLimiter()
	poller.maxRetry = 1
	poller.maxBackoff = time.Millisecond
	poller.jitterFactor = 0
	poller.nodeLister = func(context.Context, *metricsclient.Clientset) (*metricsv1beta1.NodeMetricsList, error) {
		return nodeList, nil
	}
	poller.podLister = func(context.Context, *metricsclient.Clientset) (*metricsv1beta1.PodMetricsList, error) {
		return podList, nil
	}

	var notified []Metadata
	poller.SetCollectionObserver(func(metadata Metadata) {
		notified = append(notified, metadata)
	})

	require.NoError(t, poller.refresh(ctx))
	require.Len(t, notified, 1)
	require.False(t, notified[0].CollectedAt.IsZero())
	require.Equal(t, uint64(1), notified[0].SuccessCount)

	// A failing collection advances failure metadata and notifies.
	poller.podLister = func(context.Context, *metricsclient.Clientset) (*metricsv1beta1.PodMetricsList, error) {
		return nil, errors.New("pods down")
	}
	require.Error(t, poller.refresh(ctx))
	require.Len(t, notified, 2)
	require.Equal(t, uint64(1), notified[1].FailureCount)
}

// The demand wrapper must pass the observer through to the inner poller so the
// doorbell wiring can be done once against the Provider the subsystem holds.
func TestDemandPollerPassesCollectionObserverThrough(t *testing.T) {
	poller := NewPoller(nil, nil, time.Second, telemetry.NewRecorder())
	demand := NewDemandPoller(poller, poller, time.Minute)

	called := false
	demand.SetCollectionObserver(func(Metadata) { called = true })
	poller.notifyCollectionObserver()
	require.True(t, called)
}

// SetInterval must retime a RUNNING poll loop: the metric cadence is now
// server-owned (the doorbell rides collections), so the user's metrics-interval
// preference has to reach a live poller without a subsystem rebuild.
func TestPollerSetIntervalRetimesRunningLoop(t *testing.T) {
	poller := NewPoller(nil, nil, time.Hour, telemetry.NewRecorder())
	poller.client = &metricsclient.Clientset{}
	poller.rateLimiter = flowcontrol.NewFakeAlwaysRateLimiter()
	poller.maxRetry = 1
	poller.maxBackoff = time.Millisecond
	poller.jitterFactor = 0
	poller.nodeLister = func(context.Context, *metricsclient.Clientset) (*metricsv1beta1.NodeMetricsList, error) {
		return &metricsv1beta1.NodeMetricsList{}, nil
	}
	poller.podLister = func(context.Context, *metricsclient.Clientset) (*metricsv1beta1.PodMetricsList, error) {
		return &metricsv1beta1.PodMetricsList{}, nil
	}

	collections := make(chan struct{}, 16)
	poller.SetCollectionObserver(func(Metadata) {
		select {
		case collections <- struct{}{}:
		default:
		}
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { _ = poller.Start(ctx) }()

	// The immediate startup collection fires regardless of interval.
	select {
	case <-collections:
	case <-time.After(2 * time.Second):
		t.Fatal("expected the startup collection")
	}

	// With a 1h interval no second collection would arrive; retiming to 20ms must
	// produce one promptly.
	poller.SetInterval(20 * time.Millisecond)
	select {
	case <-collections:
	case <-time.After(2 * time.Second):
		t.Fatal("SetInterval did not retime the running poll loop")
	}
}

// The demand wrapper passes SetInterval through to the wrapped poller.
func TestDemandPollerPassesSetIntervalThrough(t *testing.T) {
	poller := NewPoller(nil, nil, time.Hour, telemetry.NewRecorder())
	demand := NewDemandPoller(poller, poller, time.Minute)

	demand.SetInterval(123 * time.Millisecond)

	poller.mu.RLock()
	defer poller.mu.RUnlock()
	require.Equal(t, 123*time.Millisecond, poller.interval)
}

func TestPollerRefreshHandlesPodMetricsFailure(t *testing.T) {
	t.Helper()

	ctx := context.Background()

	nodeList := &metricsv1beta1.NodeMetricsList{
		Items: []metricsv1beta1.NodeMetrics{{
			ObjectMeta: metav1.ObjectMeta{Name: "node-a"},
			Usage: corev1.ResourceList{
				corev1.ResourceCPU:    *resource.NewMilliQuantity(200, resource.DecimalSI),
				corev1.ResourceMemory: *resource.NewQuantity(128*1024*1024, resource.BinarySI),
			},
		}},
	}

	recorder := telemetry.NewRecorder()
	poller := NewPoller(nil, nil, time.Second, recorder)
	poller.client = &metricsclient.Clientset{}
	poller.rateLimiter = flowcontrol.NewFakeAlwaysRateLimiter()
	poller.maxRetry = 1
	poller.maxBackoff = time.Millisecond
	poller.jitterFactor = 0

	poller.nodeLister = func(context.Context, *metricsclient.Clientset) (*metricsv1beta1.NodeMetricsList, error) {
		return nodeList, nil
	}
	poller.podLister = func(context.Context, *metricsclient.Clientset) (*metricsv1beta1.PodMetricsList, error) {
		return nil, errors.New("pods down")
	}

	err := poller.refresh(ctx)
	require.Error(t, err)

	nodes := poller.LatestNodeUsage()
	require.Equal(t, NodeUsage{CPUUsageMilli: 200, MemoryUsageBytes: 128 * 1024 * 1024}, nodes["node-a"])

	pods := poller.LatestPodUsage()
	require.Empty(t, pods)

	meta := poller.Metadata()
	require.Equal(t, uint64(0), meta.SuccessCount)
	require.Equal(t, uint64(1), meta.FailureCount)
	require.Equal(t, 1, meta.ConsecutiveFailures)
	require.Contains(t, meta.LastError, "pod metrics poll failed")

	summary := recorder.SnapshotSummary()
	require.Equal(t, uint64(1), summary.Metrics.FailureCount)
	require.NotEmpty(t, summary.Metrics.LastError)
}

func TestPollerRefreshHandlesUnavailableMetricsAPI(t *testing.T) {
	t.Helper()

	ctx := context.Background()

	recorder := telemetry.NewRecorder()
	poller := NewPoller(nil, nil, time.Second, recorder)
	poller.client = &metricsclient.Clientset{}
	poller.rateLimiter = flowcontrol.NewFakeAlwaysRateLimiter()
	poller.maxRetry = 1
	poller.maxBackoff = time.Millisecond
	poller.jitterFactor = 0

	poller.nodeLister = func(context.Context, *metricsclient.Clientset) (*metricsv1beta1.NodeMetricsList, error) {
		return nil, errMetricsAPIUnavailable
	}
	poller.podLister = func(context.Context, *metricsclient.Clientset) (*metricsv1beta1.PodMetricsList, error) {
		return &metricsv1beta1.PodMetricsList{}, nil
	}

	err := poller.refresh(ctx)
	require.ErrorIs(t, err, errMetricsAPIUnavailable)

	meta := poller.Metadata()
	require.Equal(t, uint64(0), meta.SuccessCount)
	require.Equal(t, uint64(1), meta.FailureCount)
	require.Equal(t, 1, meta.ConsecutiveFailures)
	require.Contains(t, meta.LastError, "metrics API unavailable")
	require.True(t, meta.CollectedAt.IsZero())

	summary := recorder.SnapshotSummary()
	require.Equal(t, uint64(1), summary.Metrics.FailureCount)
	require.Contains(t, summary.Metrics.LastError, "metrics API unavailable")
}

func TestPollerRefreshRequiresConfig(t *testing.T) {
	t.Helper()

	recorder := telemetry.NewRecorder()
	poller := NewPoller(nil, nil, time.Second, recorder)
	poller.rateLimiter = flowcontrol.NewFakeAlwaysRateLimiter()

	err := poller.refresh(context.Background())
	require.Error(t, err)
	require.Contains(t, err.Error(), "rest config not provided")

	meta := poller.Metadata()
	require.Equal(t, uint64(0), meta.SuccessCount)
	require.Equal(t, uint64(1), meta.FailureCount)
	require.Equal(t, 1, meta.ConsecutiveFailures)
	require.Contains(t, meta.LastError, "rest config not provided")

	summary := recorder.SnapshotSummary()
	require.Equal(t, uint64(1), summary.Metrics.FailureCount)
	require.Contains(t, summary.Metrics.LastError, "rest config not provided")
}

// TestPollerRefreshCapturesSampleTimestamps proves each parsed pod/node usage
// carries metrics-server's per-sample Timestamp (the right edge of the scrape
// interval), so the overlay can drop a sample that predates a recreated object.
func TestPollerRefreshCapturesSampleTimestamps(t *testing.T) {
	ctx := context.Background()

	nodeStamp := time.Date(2026, 6, 25, 10, 0, 0, 0, time.UTC)
	podStamp := time.Date(2026, 6, 25, 10, 0, 5, 0, time.UTC)

	nodeList := &metricsv1beta1.NodeMetricsList{
		Items: []metricsv1beta1.NodeMetrics{{
			ObjectMeta: metav1.ObjectMeta{Name: "node-a"},
			Timestamp:  metav1.NewTime(nodeStamp),
			Usage: corev1.ResourceList{
				corev1.ResourceCPU: *resource.NewMilliQuantity(250, resource.DecimalSI),
			},
		}},
	}
	podList := &metricsv1beta1.PodMetricsList{
		Items: []metricsv1beta1.PodMetrics{{
			ObjectMeta: metav1.ObjectMeta{Name: "api-0", Namespace: "default"},
			Timestamp:  metav1.NewTime(podStamp),
			Containers: []metricsv1beta1.ContainerMetrics{{
				Name:  "api",
				Usage: corev1.ResourceList{corev1.ResourceCPU: *resource.NewMilliQuantity(125, resource.DecimalSI)},
			}},
		}},
	}

	poller := NewPoller(nil, nil, time.Second, telemetry.NewRecorder())
	poller.client = &metricsclient.Clientset{}
	poller.rateLimiter = flowcontrol.NewFakeAlwaysRateLimiter()
	poller.maxRetry = 1
	poller.jitterFactor = 0
	poller.nodeLister = func(context.Context, *metricsclient.Clientset) (*metricsv1beta1.NodeMetricsList, error) {
		return nodeList, nil
	}
	poller.podLister = func(context.Context, *metricsclient.Clientset) (*metricsv1beta1.PodMetricsList, error) {
		return podList, nil
	}

	require.NoError(t, poller.refresh(ctx))

	require.Equal(t, nodeStamp, poller.LatestNodeUsage()["node-a"].Timestamp)
	require.Equal(t, podStamp, poller.LatestPodUsage()["default/api-0"].Timestamp)
}

func TestJitterDurationHandlesNonPositiveFactor(t *testing.T) {
	base := time.Second
	if got := jitterDuration(base, 0); got != base {
		t.Fatalf("expected base duration when factor zero, got %s", got)
	}
	if got := jitterDuration(base, -0.5); got != base {
		t.Fatalf("expected base duration when factor negative, got %s", got)
	}
}

func TestLatestUsageReturnsCopies(t *testing.T) {
	t.Helper()

	poller := NewPoller(nil, nil, time.Second, nil)
	poller.nodeUsage = map[string]NodeUsage{"node": {CPUUsageMilli: 100}}
	poller.podUsage = map[string]PodUsage{"ns/pod": {CPUUsageMilli: 50}}

	nodes := poller.LatestNodeUsage()
	nodes["node"] = NodeUsage{}
	require.NotEqual(t, NodeUsage{}, poller.nodeUsage["node"])

	pods := poller.LatestPodUsage()
	pods["ns/pod"] = PodUsage{}
	require.NotEqual(t, PodUsage{}, poller.podUsage["ns/pod"])
}

func TestDisabledPollerMetadata(t *testing.T) {
	t.Helper()

	recorder := telemetry.NewRecorder()
	poller := NewDisabledPoller(recorder, "")

	require.NoError(t, poller.Start(context.Background()))
	require.NoError(t, poller.Stop(context.Background()))

	require.Empty(t, poller.LatestNodeUsage())
	require.Empty(t, poller.LatestPodUsage())

	meta := poller.Metadata()
	require.True(t, meta.CollectedAt.IsZero())
	require.Equal(t, "metrics polling disabled", meta.LastError)
	require.Zero(t, meta.FailureCount)
	require.Zero(t, meta.SuccessCount)
	// Disabled marks this as a terminal state (not a pre-first-poll window) so the
	// serve-time grace period never clears LastError.
	require.True(t, meta.Disabled)

	custom := NewDisabledPoller(nil, "cluster has no metrics API")
	require.Equal(t, "cluster has no metrics API", custom.Metadata().LastError)
	require.True(t, custom.Metadata().Disabled)
}

// Scoped clusters (docs/plans/namespace-scope.md): pod metrics are listed per
// configured namespace — a scoped identity cannot list metrics cluster-wide —
// and one failing namespace must not blank the others' usage.
func TestScopedPollerListsPodMetricsPerNamespace(t *testing.T) {
	poller := NewPoller(nil, nil, time.Hour, nil)
	poller.SetAllowedNamespaces([]string{"prod", "dev"})

	var listed []string
	poller.podNamespaceLister = func(_ context.Context, _ *metricsclient.Clientset, namespace string) (*metricsv1beta1.PodMetricsList, error) {
		listed = append(listed, namespace)
		if namespace == "dev" {
			return nil, errors.New("forbidden")
		}
		return &metricsv1beta1.PodMetricsList{Items: []metricsv1beta1.PodMetrics{{
			ObjectMeta: metav1.ObjectMeta{Namespace: namespace, Name: "pod-a"},
		}}}, nil
	}

	resp, err := poller.podLister(context.Background(), nil)
	if err != nil {
		t.Fatalf("one failing namespace must not fail the scoped pod-metrics list: %v", err)
	}
	if len(listed) != 2 || listed[0] != "prod" || listed[1] != "dev" {
		t.Fatalf("expected per-namespace lists over the scope, got %v", listed)
	}
	if len(resp.Items) != 1 || resp.Items[0].Namespace != "prod" {
		t.Fatalf("expected the successful namespace's items, got %#v", resp.Items)
	}
}

func TestUnscopedPollerKeepsClusterWidePodList(t *testing.T) {
	poller := NewPoller(nil, nil, time.Hour, nil)

	var namespaces []string
	poller.podNamespaceLister = func(_ context.Context, _ *metricsclient.Clientset, namespace string) (*metricsv1beta1.PodMetricsList, error) {
		namespaces = append(namespaces, namespace)
		return &metricsv1beta1.PodMetricsList{}, nil
	}

	if _, err := poller.podLister(context.Background(), nil); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(namespaces) != 1 || namespaces[0] != "" {
		t.Fatalf("unscoped poller must issue exactly one cluster-wide list, got %v", namespaces)
	}
}
