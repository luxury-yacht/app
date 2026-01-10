/*
 * backend/capabilities/service.go
 *
 * This service evaluates Kubernetes RBAC capabilities by submitting
 * SelfSubjectAccessReview requests to the Kubernetes API.
 */

package capabilities

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/luxury-yacht/app/backend/resources/common"
	authorizationv1 "k8s.io/api/authorization/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Service evaluates capability checks against the Kubernetes API.
type Service struct {
	deps Dependencies
}

// Dependencies supplies collaborators required by the capability service.
type Dependencies struct {
	Common               common.Dependencies
	WorkerCount          int
	RequestsPerSecond    float64
	SlowRequestThreshold time.Duration
	RateLimiter          RateLimiter
	RateLimiterFactory   func(qps float64) RateLimiter
	Now                  func() time.Time
}

const (
	defaultWorkerCount       = 4
	defaultRequestsPerSecond = 5.0
	defaultSlowThreshold     = 750 * time.Millisecond
)

// RateLimiter gates outbound SelfSubjectAccessReview requests.
type RateLimiter interface {
	Wait(ctx context.Context) error
	Stop()
}

type namespaceMetrics struct {
	Count         int
	Allowed       int
	Errors        int
	TotalDuration time.Duration
}

// ReviewAttributes couples a caller-supplied identifier with the corresponding
// authorisation attributes that will be submitted to the cluster.
type ReviewAttributes struct {
	ID         string
	Attributes *authorizationv1.ResourceAttributes
}

// NewService constructs a capability evaluation service.
func NewService(deps Dependencies) *Service {
	return &Service{deps: deps}
}

// Evaluate submits SelfSubjectAccessReview requests for the supplied attribute
// set and returns structured results for each check. The caller is responsible
// for ensuring attributes are well-formed (the service treats nil attributes as
// errors and records them in the result set).
func (s *Service) Evaluate(ctx context.Context, checks []ReviewAttributes) ([]CheckResult, error) {
	results := make([]CheckResult, len(checks))
	if len(checks) == 0 {
		return results, nil
	}

	if err := s.ensureClient(); err != nil {
		return nil, err
	}

	limiter := s.buildRateLimiter()
	if limiter != nil {
		defer limiter.Stop()
	}

	workerCount := s.resolveWorkerCount(len(checks))
	slowThreshold := s.resolveSlowThreshold()
	nowFn := s.now

	type evalJob struct {
		index int
		check ReviewAttributes
	}

	jobs := make(chan evalJob)
	var wg sync.WaitGroup
	collectMetrics := s.deps.Common.Logger != nil
	metricsMu := sync.Mutex{}
	metricsByNamespace := make(map[string]*namespaceMetrics)
	var failureCount atomic.Int32

	for i := 0; i < workerCount; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()

			for job := range jobs {
				result := CheckResult{ID: job.check.ID}
				attrs := job.check.Attributes

				if attrs == nil {
					result.Error = "resource attributes missing"
					results[job.index] = result
					continue
				}

				if limiter != nil {
					if err := limiter.Wait(ctx); err != nil {
						result.Error = err.Error()
						results[job.index] = result
						continue
					}
				}

				review := &authorizationv1.SelfSubjectAccessReview{
					Spec: authorizationv1.SelfSubjectAccessReviewSpec{
						ResourceAttributes: attrs,
					},
				}

				start := nowFn()
				response, err := s.deps.Common.KubernetesClient.AuthorizationV1().
					SelfSubjectAccessReviews().
					Create(ctx, review, metav1.CreateOptions{})
				duration := nowFn().Sub(start)

				if err != nil {
					s.logError(fmt.Sprintf("Capability check %s failed: %v", job.check.ID, err))
					result.Error = err.Error()
				} else {
					result.Allowed = response.Status.Allowed
					result.DeniedReason = response.Status.Reason
					result.EvaluationError = response.Status.EvaluationError

					if slowThreshold > 0 && duration > slowThreshold {
						s.logWarn(fmt.Sprintf("Capability check %s slow: %s", job.check.ID, duration))
					}
				}

				if collectMetrics {
					metricsMu.Lock()
					nsKey := namespaceMetricKey(attrs.Namespace)
					metric := metricsByNamespace[nsKey]
					if metric == nil {
						metric = &namespaceMetrics{}
						metricsByNamespace[nsKey] = metric
					}
					metric.Count++
					if result.Allowed {
						metric.Allowed++
					}
					if result.Error != "" || result.EvaluationError != "" {
						metric.Errors++
					}
					metric.TotalDuration += duration
					metricsMu.Unlock()
				}

				if result.Error != "" || result.EvaluationError != "" {
					failureCount.Add(1)
				}

				results[job.index] = result
			}
		}()
	}

	for idx, check := range checks {
		jobs <- evalJob{index: idx, check: check}
	}
	close(jobs)
	wg.Wait()

	if collectMetrics {
		metricsMu.Lock()
		snapshot := make(map[string]namespaceMetrics, len(metricsByNamespace))
		for ns, metric := range metricsByNamespace {
			snapshot[ns] = *metric
		}
		metricsMu.Unlock()
		s.logNamespaceMetrics(snapshot)
	}

	if err := ctx.Err(); err != nil {
		return results, err
	}
	if int(failureCount.Load()) == len(checks) && len(checks) > 0 {
		return results, fmt.Errorf("all capability checks failed")
	}
	return results, nil
}

func (s *Service) ensureClient() error {
	if s.deps.Common.KubernetesClient == nil {
		return fmt.Errorf("kubernetes client not initialized")
	}

	if s.deps.Common.EnsureClient != nil {
		return s.deps.Common.EnsureClient("SelfSubjectAccessReview")
	}

	return nil
}

func (s *Service) logError(message string) {
	if s.deps.Common.Logger != nil {
		s.deps.Common.Logger.Error(message, "Capabilities")
	}
}

func (s *Service) logWarn(message string) {
	if s.deps.Common.Logger != nil {
		s.deps.Common.Logger.Warn(message, "Capabilities")
	}
}

func (s *Service) logDebug(message string) {
	if s.deps.Common.Logger != nil {
		s.deps.Common.Logger.Debug(message, "Capabilities")
	}
}

func (s *Service) resolveWorkerCount(requestCount int) int {
	if requestCount <= 0 {
		return 0
	}
	count := s.deps.WorkerCount
	if count <= 0 {
		count = defaultWorkerCount
	}
	if count > requestCount {
		count = requestCount
	}
	if count <= 0 {
		count = 1
	}
	return count
}

func (s *Service) resolveSlowThreshold() time.Duration {
	if s.deps.SlowRequestThreshold > 0 {
		return s.deps.SlowRequestThreshold
	}
	return defaultSlowThreshold
}

func (s *Service) buildRateLimiter() RateLimiter {
	if s.deps.RateLimiter != nil {
		return s.deps.RateLimiter
	}
	qps := s.deps.RequestsPerSecond
	if qps <= 0 {
		qps = defaultRequestsPerSecond
	}
	if qps <= 0 {
		return nil
	}
	if s.deps.RateLimiterFactory != nil {
		return s.deps.RateLimiterFactory(qps)
	}
	return newTickerRateLimiter(qps)
}

func (s *Service) now() time.Time {
	if s.deps.Now != nil {
		return s.deps.Now()
	}
	return time.Now()
}

func namespaceMetricKey(namespace string) string {
	if strings.TrimSpace(namespace) == "" {
		return "<cluster>"
	}
	return namespace
}

func (s *Service) logNamespaceMetrics(metrics map[string]namespaceMetrics) {
	if len(metrics) == 0 {
		return
	}

	entries := make([]string, 0, len(metrics))
	for namespace, data := range metrics {
		avg := time.Duration(0)
		if data.Count > 0 {
			avg = data.TotalDuration / time.Duration(data.Count)
		}
		entry := fmt.Sprintf("namespace=%s count=%d allowed=%d errors=%d avg=%s", namespace, data.Count, data.Allowed, data.Errors, avg)
		entries = append(entries, entry)
	}

	s.logDebug("Capability batch metrics: " + strings.Join(entries, "; "))
}

type tickerRateLimiter struct {
	ticker *time.Ticker
	first  uint32
}

func newTickerRateLimiter(qps float64) RateLimiter {
	if qps <= 0 {
		return nil
	}
	interval := time.Duration(float64(time.Second) / qps)
	if interval <= 0 {
		interval = time.Millisecond
	}
	return &tickerRateLimiter{ticker: time.NewTicker(interval)}
}

func (t *tickerRateLimiter) Wait(ctx context.Context) error {
	if t == nil || t.ticker == nil {
		return nil
	}

	if atomic.CompareAndSwapUint32(&t.first, 0, 1) {
		return nil
	}

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.ticker.C:
		return nil
	}
}

func (t *tickerRateLimiter) Stop() {
	if t == nil || t.ticker == nil {
		return
	}
	t.ticker.Stop()
}
