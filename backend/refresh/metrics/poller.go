package metrics

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math/rand"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/util/flowcontrol"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

// NodeUsage captures aggregate CPU/Memory usage for a node.
type NodeUsage struct {
	CPUUsageMilli    int64
	MemoryUsageBytes int64
}

// PodUsage captures usage for an individual pod (aggregated across containers).
type PodUsage struct {
	CPUUsageMilli    int64
	MemoryUsageBytes int64
}

// Metadata captures poller health information.
type Metadata struct {
	CollectedAt         time.Time
	ConsecutiveFailures int
	LastError           string
	SuccessCount        uint64
	FailureCount        uint64
}

var (
	errMetricsAPIUnavailable = errors.New("metrics API unavailable")
	jitterRand               = rand.New(rand.NewSource(time.Now().UnixNano()))
	jitterRandMu             sync.Mutex
)

// Provider exposes read-only access to the latest metrics snapshot.
type Provider interface {
	LatestNodeUsage() map[string]NodeUsage
	LatestPodUsage() map[string]PodUsage
	Metadata() Metadata
}

func copyNodeUsage(source map[string]NodeUsage) map[string]NodeUsage {
	out := make(map[string]NodeUsage, len(source))
	for k, v := range source {
		out[k] = v
	}
	return out
}

func copyPodUsage(source map[string]PodUsage) map[string]PodUsage {
	out := make(map[string]PodUsage, len(source))
	for k, v := range source {
		out[k] = v
	}
	return out
}

// Poller periodically collects metrics from metrics-server.
type Poller struct {
	interval     time.Duration
	restConfig   *rest.Config
	rateLimiter  flowcontrol.RateLimiter
	maxBackoff   time.Duration
	maxRetry     int
	jitterFactor float64
	telemetry    *telemetry.Recorder

	// clientMu protects client initialization to prevent race conditions
	clientMu sync.Mutex
	client   *metricsclient.Clientset

	mu                 sync.RWMutex
	nodeUsage          map[string]NodeUsage
	podUsage           map[string]PodUsage
	lastCollected      time.Time
	lastSuccess        time.Time
	consecutiveFailure int
	lastError          string
	successCount       uint64
	failureCount       uint64

	nodeLister func(context.Context, *metricsclient.Clientset) (*metricsv1beta1.NodeMetricsList, error)
	podLister  func(context.Context, *metricsclient.Clientset) (*metricsv1beta1.PodMetricsList, error)
}

// NewPoller creates a Poller with optional pre-initialised metrics client.
func NewPoller(client *metricsclient.Clientset, restConfig *rest.Config, interval time.Duration, recorder *telemetry.Recorder) *Poller {
	if interval <= 0 {
		interval = config.RefreshMetricsInterval
	}
	p := &Poller{
		interval:     interval,
		client:       client,
		restConfig:   restConfig,
		rateLimiter:  flowcontrol.NewTokenBucketRateLimiter(5, 10),
		maxBackoff:   config.MetricsMaxBackoff,
		maxRetry:     5,
		jitterFactor: 0.2,
		nodeUsage:    make(map[string]NodeUsage),
		podUsage:     make(map[string]PodUsage),
		telemetry:    recorder,
	}
	p.nodeLister = p.listNodeMetricsWithRetry
	p.podLister = p.listPodMetricsWithRetry
	return p
}

// LatestNodeUsage returns a copy of the most recent node usage map.
func (p *Poller) LatestNodeUsage() map[string]NodeUsage {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return copyNodeUsage(p.nodeUsage)
}

// LatestPodUsage returns a copy of the most recent pod usage map keyed by namespace/name.
func (p *Poller) LatestPodUsage() map[string]PodUsage {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return copyPodUsage(p.podUsage)
}

// Metadata returns the most recent poller status.
func (p *Poller) Metadata() Metadata {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return Metadata{
		CollectedAt:         p.lastCollected,
		ConsecutiveFailures: p.consecutiveFailure,
		LastError:           p.lastError,
		SuccessCount:        p.successCount,
		FailureCount:        p.failureCount,
	}
}

// Start polls metrics until the context is cancelled.
func (p *Poller) Start(ctx context.Context) error {
	ticker := time.NewTicker(p.interval)
	defer ticker.Stop()

	p.recordActive(true)
	defer p.recordActive(false)

	log.Printf("[refresh:metrics] poller started, interval=%s", p.interval)

	if err := p.refresh(ctx); err != nil {
		log.Printf("[refresh:metrics] initial refresh failed: %v", err)
	}

	for {
		select {
		case <-ctx.Done():
			log.Printf("[refresh:metrics] poller stopped: %v", ctx.Err())
			return ctx.Err()
		case <-ticker.C:
			if err := p.refresh(ctx); err != nil {
				log.Printf("[refresh:metrics] refresh failed: %v", err)
			}
		}
	}
}

// Stop relies on context cancellation; provided for interface parity.
func (p *Poller) Stop(ctx context.Context) error {
	log.Printf("[refresh:metrics] stop requested")
	return nil
}

func (p *Poller) refresh(ctx context.Context) error {
	if err := p.rateLimiter.Wait(ctx); err != nil {
		return err
	}

	start := time.Now()

	client, err := p.ensureClient()
	if err != nil {
		p.recordFailure(err, "metrics client", time.Since(start))
		return err
	}

	nodeResp, err := p.nodeLister(ctx, client)
	if err != nil {
		p.recordFailure(err, "nodes.metrics.k8s.io", time.Since(start))
		return err
	}

	nodeUsage := make(map[string]NodeUsage, len(nodeResp.Items))
	for _, metric := range nodeResp.Items {
		usage := NodeUsage{}
		for resourceName, quantity := range metric.Usage {
			switch resourceName {
			case corev1.ResourceCPU:
				usage.CPUUsageMilli = quantity.MilliValue()
			case corev1.ResourceMemory:
				usage.MemoryUsageBytes = quantity.Value()
			}
		}
		nodeUsage[metric.Name] = usage
	}

	podResp, err := p.podLister(ctx, client)
	if err != nil {
		p.mu.Lock()
		p.nodeUsage = nodeUsage
		p.mu.Unlock()
		wrappedErr := fmt.Errorf("pod metrics poll failed: %w", err)
		p.recordFailure(wrappedErr, "pods.metrics.k8s.io", time.Since(start))
		return err
	}

	podUsage := make(map[string]PodUsage, len(podResp.Items))
	for _, metric := range podResp.Items {
		usage := PodUsage{}
		for _, container := range metric.Containers {
			for resourceName, quantity := range container.Usage {
				switch resourceName {
				case corev1.ResourceCPU:
					usage.CPUUsageMilli += quantity.MilliValue()
				case corev1.ResourceMemory:
					usage.MemoryUsageBytes += quantity.Value()
				}
			}
		}
		key := fmt.Sprintf("%s/%s", metric.Namespace, metric.Name)
		podUsage[key] = usage
	}

	p.mu.Lock()
	p.nodeUsage = nodeUsage
	p.podUsage = podUsage
	now := time.Now()
	p.lastCollected = now
	p.lastSuccess = now
	p.consecutiveFailure = 0
	p.lastError = ""
	p.successCount++
	p.mu.Unlock()

	// log.Printf("[refresh:metrics] poll succeeded: nodeMetrics=%d podMetrics=%d totalSuccess=%d", len(nodeUsage), len(podUsage), p.successCount)
	if p.telemetry != nil {
		p.recordMetricsTelemetry(time.Since(start), now, nil, 0, true)
	}

	return nil
}

func (p *Poller) listNodeMetricsWithRetry(ctx context.Context, client *metricsclient.Clientset) (*metricsv1beta1.NodeMetricsList, error) {
	var attempt int
	backoff := config.MetricsInitialBackoff

	for {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}

		resp, err := client.MetricsV1beta1().NodeMetricses().List(ctx, metav1.ListOptions{})
		if err == nil {
			return resp, nil
		}

		if apierrors.IsNotFound(err) {
			return nil, errMetricsAPIUnavailable
		}

		attempt++
		if attempt >= p.maxRetry {
			return nil, err
		}

		log.Printf("[refresh:metrics] list failed (attempt %d/%d): %v", attempt, p.maxRetry, err)

		sleep := jitterDuration(backoff, p.jitterFactor)
		log.Printf("[refresh:metrics] retrying in %s", sleep)

		select {
		case <-time.After(sleep):
		case <-ctx.Done():
			return nil, ctx.Err()
		}

		backoff = time.Duration(float64(backoff) * 2)
		if backoff > p.maxBackoff {
			backoff = p.maxBackoff
		}
	}
}

func (p *Poller) listPodMetricsWithRetry(ctx context.Context, client *metricsclient.Clientset) (*metricsv1beta1.PodMetricsList, error) {
	var attempt int
	backoff := config.MetricsInitialBackoff

	for {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}

		resp, err := client.MetricsV1beta1().PodMetricses("").List(ctx, metav1.ListOptions{})
		if err == nil {
			return resp, nil
		}

		if apierrors.IsNotFound(err) {
			return nil, errMetricsAPIUnavailable
		}

		attempt++
		if attempt >= p.maxRetry {
			return nil, err
		}

		log.Printf("[refresh:metrics] pod list failed (attempt %d/%d): %v", attempt, p.maxRetry, err)

		sleep := jitterDuration(backoff, p.jitterFactor)
		log.Printf("[refresh:metrics] retrying pod metrics in %s", sleep)

		select {
		case <-time.After(sleep):
		case <-ctx.Done():
			return nil, ctx.Err()
		}

		backoff = time.Duration(float64(backoff) * 2)
		if backoff > p.maxBackoff {
			backoff = p.maxBackoff
		}
	}
}

func (p *Poller) recordFailure(err error, api string, duration time.Duration) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.consecutiveFailure++
	p.failureCount++
	if errors.Is(err, errMetricsAPIUnavailable) {
		p.lastError = fmt.Sprintf("metrics API unavailable (%s)", api)
		p.lastCollected = time.Time{}
	} else {
		p.lastError = err.Error()
	}
	consecutive := p.consecutiveFailure
	log.Printf("[refresh:metrics] poll failed (%s): %v (failures=%d)", api, err, p.failureCount)
	p.recordMetricsTelemetry(duration, time.Time{}, err, consecutive, false)
}

func (p *Poller) recordMetricsTelemetry(duration time.Duration, collectedAt time.Time, err error, consecutive int, success bool) {
	if p.telemetry == nil {
		return
	}
	p.telemetry.RecordMetrics(duration, collectedAt, err, consecutive, success)
}

func (p *Poller) recordActive(active bool) {
	if p.telemetry == nil {
		return
	}
	p.telemetry.RecordMetricsActive(active)
}

func jitterDuration(base time.Duration, factor float64) time.Duration {
	if factor <= 0 {
		return base
	}
	min := 1 - factor
	max := 1 + factor
	jitterRandMu.Lock()
	multiplier := min + jitterRand.Float64()*(max-min)
	jitterRandMu.Unlock()
	return time.Duration(float64(base) * multiplier)
}

func (p *Poller) ensureClient() (*metricsclient.Clientset, error) {
	p.clientMu.Lock()
	defer p.clientMu.Unlock()

	// Double-check after acquiring lock
	if p.client != nil {
		return p.client, nil
	}
	if p.restConfig == nil {
		return nil, fmt.Errorf("rest config not provided")
	}
	client, err := metricsclient.NewForConfig(p.restConfig)
	if err != nil {
		return nil, err
	}
	p.client = client
	return client, nil
}
