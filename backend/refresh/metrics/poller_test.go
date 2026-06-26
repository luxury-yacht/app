package metrics

import (
	"context"
	"errors"
	"strconv"
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

func TestPollerRefreshSuccessNotifiesObserverWithMetricsRevision(t *testing.T) {
	ctx := context.Background()
	nodeList := &metricsv1beta1.NodeMetricsList{}
	podList := &metricsv1beta1.PodMetricsList{}

	poller := NewPoller(nil, nil, time.Second, nil)
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

	var observedRevision string
	var observed Metadata
	poller.SetSuccessObserver(func(revision string, meta Metadata) {
		observedRevision = revision
		observed = meta
	})

	require.NoError(t, poller.refresh(ctx))
	require.False(t, observed.CollectedAt.IsZero())
	require.Equal(t, uint64(1), observed.SuccessCount)
	require.Equal(t, strconv.FormatInt(observed.CollectedAt.UnixNano(), 10), observedRevision)
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

	custom := NewDisabledPoller(nil, "cluster has no metrics API")
	require.Equal(t, "cluster has no metrics API", custom.Metadata().LastError)
}
