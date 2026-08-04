package metrics

import (
	"context"
	"errors"
	"fmt"
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

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

// NodeUsage captures aggregate CPU/Memory usage for a node.
type NodeUsage struct {
	CPUUsageMilli    int64
	MemoryUsageBytes int64
	// Timestamp is metrics-server's per-sample timestamp (the right edge of the
	// scrape interval [Timestamp-Window, Timestamp]). The overlay drops a sample
	// that predates a same-named object's creation, so a deleted-and-recreated
	// node never inherits a prior incarnation's numbers.
	Timestamp time.Time
}

// PodUsage captures usage for an individual pod (aggregated across containers).
type PodUsage struct {
	CPUUsageMilli    int64
	MemoryUsageBytes int64
	// Timestamp is metrics-server's per-sample timestamp; see NodeUsage.Timestamp.
	Timestamp time.Time
}

// Metadata captures poller health information.
type Metadata struct {
	CollectedAt         time.Time
	ConsecutiveFailures int
	LastError           string
	SuccessCount        uint64
	FailureCount        uint64
	// Disabled marks a terminal "metrics will never be collected" state (metrics
	// API forbidden, or metrics-server absent) as distinct from a real poller
	// whose first collection has simply not completed yet. LastError then holds a
	// permanent, UI-ready reason that must not be treated as a transient
	// pre-first-poll error.
	Disabled bool
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
	Sample() Sample
}

// Sample is a mutually consistent view of one collection: the usage maps and
// the metadata are read under one lock, so a consumer can never observe usage
// from one collection paired with another collection's metadata — the serve-time
// join stamps Metadata.CollectedAt as the snapshot's metric source clock, and a
// torn pair would stamp a revision the joined rows don't contain. Consumers
// that pair usage with metadata must use Sample, not the individual accessors.
type Sample struct {
	NodeUsage map[string]NodeUsage
	PodUsage  map[string]PodUsage
	Metadata  Metadata
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
	// interval is guarded by mu after construction (SetInterval can retime it).
	interval     time.Duration
	restConfig   *rest.Config
	rateLimiter  flowcontrol.RateLimiter
	maxBackoff   time.Duration
	maxRetry     int
	jitterFactor float64
	telemetry    *telemetry.Recorder
	logger       applog.Logger

	// clientMu protects client initialization to prevent race conditions
	clientMu sync.Mutex
	client   metricsclient.Interface

	mu                 sync.RWMutex
	nodeUsage          map[string]NodeUsage
	podUsage           map[string]PodUsage
	lastCollected      time.Time
	lastSuccess        time.Time
	consecutiveFailure int
	lastError          string
	successCount       uint64
	failureCount       uint64
	// Failure reporting is bounded per API for one uninterrupted failure run.
	// A successful collection clears both sets so a later outage is actionable
	// without turning a five-second poll loop into repeated Sentry events.
	reportedFailureAPIs   map[string]struct{}
	warnedUnavailableAPIs map[string]struct{}
	// ticker is the running loop's ticker (nil when not running); held under mu
	// so SetInterval can retime a live loop.
	ticker *time.Ticker

	nodeLister func(context.Context, metricsclient.Interface) (*metricsv1beta1.NodeMetricsList, error)
	podLister  func(context.Context, metricsclient.Interface) (*metricsv1beta1.PodMetricsList, error)
	// podNamespaceLister lists one namespace's pod metrics ("" = cluster-wide);
	// podLister fans it over the configured scope (injectable in tests).
	podNamespaceLister func(context.Context, metricsclient.Interface, string) (*metricsv1beta1.PodMetricsList, error)
	// allowedNamespaces is the cluster's namespace scope
	// (docs/plans/namespace-scope.md): non-empty makes the pod-metrics list
	// run per configured namespace, with one failing namespace skipped
	// instead of blanking the others. Node metrics stay cluster-scoped.
	allowedNamespaces []string

	// observerMu guards collectionObserver. The observer is notified after every
	// completed collection attempt: successes drive every metric-bearing domain,
	// while failures drive only consumers whose payload exposes poller health.
	observerMu         sync.Mutex
	collectionObserver func(Metadata)
}

// SetInterval retimes the poll cadence. It applies immediately to a running
// loop (the live ticker is reset), so the user's metrics-interval preference
// reaches the server-owned schedule without a subsystem rebuild.
func (p *Poller) SetInterval(interval time.Duration) {
	if interval <= 0 {
		interval = config.RefreshMetricsInterval
	}
	p.mu.Lock()
	p.interval = interval
	ticker := p.ticker
	p.mu.Unlock()
	if ticker != nil {
		ticker.Reset(interval)
	}
}

// SetLogger routes poller diagnostics through the application logger so
// severity and cluster scope remain explicit at the reporting boundary.
func (p *Poller) SetLogger(logger applog.Logger) {
	if logger == nil {
		logger = applog.Noop
	}
	p.mu.Lock()
	p.logger = logger
	p.mu.Unlock()
}

func (p *Poller) applicationLogger() applog.Logger {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.logger
}

// SetCollectionObserver registers a callback invoked with fresh Metadata after
// each collection attempt. One observer; last write wins.
func (p *Poller) SetCollectionObserver(observer func(Metadata)) {
	p.observerMu.Lock()
	p.collectionObserver = observer
	p.observerMu.Unlock()
}

// notifyCollectionObserver invokes the registered observer (if any) with the
// current metadata. Called outside p.mu so an observer can read the provider.
func (p *Poller) notifyCollectionObserver() {
	p.observerMu.Lock()
	observer := p.collectionObserver
	p.observerMu.Unlock()
	if observer == nil {
		return
	}
	observer(p.Metadata())
}

// NewPoller creates a Poller with optional pre-initialised metrics client.
func NewPoller(client metricsclient.Interface, restConfig *rest.Config, interval time.Duration, recorder *telemetry.Recorder) *Poller {
	if interval <= 0 {
		interval = config.RefreshMetricsInterval
	}
	p := &Poller{
		interval:              interval,
		client:                client,
		restConfig:            restConfig,
		rateLimiter:           flowcontrol.NewTokenBucketRateLimiter(5, 10),
		maxBackoff:            config.MetricsMaxBackoff,
		maxRetry:              5,
		jitterFactor:          0.2,
		nodeUsage:             make(map[string]NodeUsage),
		podUsage:              make(map[string]PodUsage),
		reportedFailureAPIs:   make(map[string]struct{}),
		warnedUnavailableAPIs: make(map[string]struct{}),
		telemetry:             recorder,
		logger:                applog.Noop,
	}
	p.nodeLister = p.listNodeMetricsWithRetry
	p.podNamespaceLister = p.listPodMetricsInNamespaceWithRetry
	p.podLister = p.listPodMetricsScoped
	return p
}

// SetAllowedNamespaces configures the cluster's namespace scope
// (docs/plans/namespace-scope.md). Call before Start.
func (p *Poller) SetAllowedNamespaces(namespaces []string) {
	if p == nil {
		return
	}
	p.allowedNamespaces = append([]string(nil), namespaces...)
}

// listPodMetricsScoped fans the pod-metrics list over the configured scope
// (one per-namespace list each), merging the successes: a namespace the
// identity cannot read is logged and skipped, never blanking the others. The
// unscoped path is the same loop with a single cluster-wide "" entry. It
// fails only when EVERY namespace fails, so the poller's failure accounting
// still fires when nothing at all is readable.
func (p *Poller) listPodMetricsScoped(ctx context.Context, client metricsclient.Interface) (*metricsv1beta1.PodMetricsList, error) {
	namespaces := []string{""}
	if len(p.allowedNamespaces) > 0 {
		namespaces = p.allowedNamespaces
	}
	merged := &metricsv1beta1.PodMetricsList{}
	var firstErr error
	succeeded := false
	for _, namespace := range namespaces {
		resp, err := p.podNamespaceLister(ctx, client, namespace)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		succeeded = true
		if resp != nil {
			merged.Items = append(merged.Items, resp.Items...)
		}
	}
	if !succeeded {
		return nil, firstErr
	}
	return merged, nil
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
	return p.metadataLocked()
}

// metadataLocked assembles the status struct; callers hold p.mu.
func (p *Poller) metadataLocked() Metadata {
	return Metadata{
		CollectedAt:         p.lastCollected,
		ConsecutiveFailures: p.consecutiveFailure,
		LastError:           p.lastError,
		SuccessCount:        p.successCount,
		FailureCount:        p.failureCount,
	}
}

// Sample returns the usage maps and metadata of one collection under a single
// lock acquisition; refresh() publishes them atomically under the same lock.
func (p *Poller) Sample() Sample {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return Sample{
		NodeUsage: copyNodeUsage(p.nodeUsage),
		PodUsage:  copyPodUsage(p.podUsage),
		Metadata:  p.metadataLocked(),
	}
}

// Start polls metrics until the context is cancelled.
func (p *Poller) Start(ctx context.Context) error {
	p.mu.Lock()
	interval := p.interval
	ticker := time.NewTicker(interval)
	p.ticker = ticker
	p.mu.Unlock()
	defer func() {
		p.mu.Lock()
		if p.ticker == ticker {
			p.ticker = nil
		}
		p.mu.Unlock()
		ticker.Stop()
	}()

	p.recordActive(true)
	defer p.recordActive(false)

	applog.Info(p.applicationLogger(), fmt.Sprintf("metrics poller started, interval=%s", interval), logsources.Metrics)

	_ = p.refresh(ctx)

	for {
		select {
		case <-ctx.Done():
			applog.Info(p.applicationLogger(), fmt.Sprintf("metrics poller stopped: %v", ctx.Err()), logsources.Metrics)
			return ctx.Err()
		case <-ticker.C:
			_ = p.refresh(ctx)
		}
	}
}

// Stop relies on context cancellation; provided for interface parity.
func (p *Poller) Stop(ctx context.Context) error {
	applog.Info(p.applicationLogger(), "metrics poller stop requested", logsources.Metrics)
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
		if errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
			return context.Canceled
		}
		p.recordFailure(err, "nodes.metrics.k8s.io", time.Since(start))
		return err
	}

	nodeUsage := nodeUsageFromMetrics(nodeResp.Items)

	podResp, err := p.podLister(ctx, client)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
			return context.Canceled
		}
		p.mu.Lock()
		p.nodeUsage = nodeUsage
		p.mu.Unlock()
		wrappedErr := fmt.Errorf("pod metrics poll failed: %w", err)
		p.recordFailure(wrappedErr, "pods.metrics.k8s.io", time.Since(start))
		return err
	}

	podUsage := podUsageFromMetrics(podResp.Items)

	p.mu.Lock()
	p.nodeUsage = nodeUsage
	p.podUsage = podUsage
	now := time.Now()
	p.lastCollected = now
	p.lastSuccess = now
	p.consecutiveFailure = 0
	p.lastError = ""
	p.successCount++
	clear(p.reportedFailureAPIs)
	clear(p.warnedUnavailableAPIs)
	p.mu.Unlock()

	// log.Printf("[refresh:metrics] poll succeeded: nodeMetrics=%d podMetrics=%d totalSuccess=%d", len(nodeUsage), len(podUsage), p.successCount)
	if p.telemetry != nil {
		p.recordMetricsTelemetry(time.Since(start), now, nil, 0, true)
	}

	p.notifyCollectionObserver()

	return nil
}

func nodeUsageFromMetrics(metrics []metricsv1beta1.NodeMetrics) map[string]NodeUsage {
	result := make(map[string]NodeUsage, len(metrics))
	for _, metric := range metrics {
		usage := NodeUsage{Timestamp: metric.Timestamp.Time}
		for resourceName, quantity := range metric.Usage {
			switch resourceName {
			case corev1.ResourceCPU:
				usage.CPUUsageMilli = quantity.MilliValue()
			case corev1.ResourceMemory:
				usage.MemoryUsageBytes = quantity.Value()
			}
		}
		result[metric.Name] = usage
	}
	return result
}

func podUsageFromMetrics(metrics []metricsv1beta1.PodMetrics) map[string]PodUsage {
	result := make(map[string]PodUsage, len(metrics))
	for _, metric := range metrics {
		usage := PodUsage{Timestamp: metric.Timestamp.Time}
		for _, container := range metric.Containers {
			addContainerUsage(&usage, container.Usage)
		}
		result[fmt.Sprintf("%s/%s", metric.Namespace, metric.Name)] = usage
	}
	return result
}

func addContainerUsage(usage *PodUsage, resources corev1.ResourceList) {
	for resourceName, quantity := range resources {
		switch resourceName {
		case corev1.ResourceCPU:
			usage.CPUUsageMilli += quantity.MilliValue()
		case corev1.ResourceMemory:
			usage.MemoryUsageBytes += quantity.Value()
		}
	}
}

func (p *Poller) listNodeMetricsWithRetry(ctx context.Context, client metricsclient.Interface) (*metricsv1beta1.NodeMetricsList, error) {
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
		if errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
			return nil, context.Canceled
		}

		if apierrors.IsNotFound(err) {
			return nil, errMetricsAPIUnavailable
		}

		attempt++
		if attempt >= p.maxRetry {
			return nil, err
		}

		applog.Warn(p.applicationLogger(), fmt.Sprintf("node metrics list failed (attempt %d/%d): %v", attempt, p.maxRetry, err), logsources.Metrics)

		sleep := jitterDuration(backoff, p.jitterFactor)
		applog.Info(p.applicationLogger(), fmt.Sprintf("retrying node metrics in %s", sleep), logsources.Metrics)

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

func (p *Poller) listPodMetricsInNamespaceWithRetry(ctx context.Context, client metricsclient.Interface, namespace string) (*metricsv1beta1.PodMetricsList, error) {
	var attempt int
	backoff := config.MetricsInitialBackoff

	for {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}

		resp, err := client.MetricsV1beta1().PodMetricses(namespace).List(ctx, metav1.ListOptions{})
		if err == nil {
			return resp, nil
		}
		if errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
			return nil, context.Canceled
		}

		if apierrors.IsNotFound(err) {
			return nil, errMetricsAPIUnavailable
		}

		attempt++
		if attempt >= p.maxRetry {
			return nil, err
		}

		applog.Warn(p.applicationLogger(), fmt.Sprintf("pod metrics list failed (attempt %d/%d): %v", attempt, p.maxRetry, err), logsources.Metrics)

		sleep := jitterDuration(backoff, p.jitterFactor)
		applog.Info(p.applicationLogger(), fmt.Sprintf("retrying pod metrics in %s", sleep), logsources.Metrics)

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
	p.consecutiveFailure++
	p.failureCount++
	apiUnavailable := errors.Is(err, errMetricsAPIUnavailable)
	shouldReport := false
	shouldWarnUnavailable := false
	if apiUnavailable {
		p.lastError = fmt.Sprintf("metrics API unavailable (%s)", api)
		p.lastCollected = time.Time{}
		if _, warned := p.warnedUnavailableAPIs[api]; !warned {
			p.warnedUnavailableAPIs[api] = struct{}{}
			shouldWarnUnavailable = true
		}
	} else {
		p.lastError = err.Error()
		if _, reported := p.reportedFailureAPIs[api]; !reported {
			p.reportedFailureAPIs[api] = struct{}{}
			shouldReport = true
		}
	}
	consecutive := p.consecutiveFailure
	failureCount := p.failureCount
	p.mu.Unlock()

	if shouldWarnUnavailable {
		applog.Warn(
			p.applicationLogger(),
			fmt.Sprintf("metrics API unavailable (%s); utilization data will remain unavailable", api),
			logsources.Metrics,
		)
	}
	if shouldReport {
		applog.ReportError(
			p.applicationLogger(),
			err,
			fmt.Sprintf("metrics poll failed (%s) (failures=%d)", api, failureCount),
			logsources.Metrics,
		)
	}
	p.recordMetricsTelemetry(duration, time.Time{}, err, consecutive, false)
	p.notifyCollectionObserver()
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

func (p *Poller) ensureClient() (metricsclient.Interface, error) {
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
