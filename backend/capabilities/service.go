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

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/k8sretry"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/internal/sentry"
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

// RateLimiter gates outbound SelfSubjectAccessReview requests.
type RateLimiter interface {
	Wait(ctx context.Context) error
	Stop()
}

type capabilityScopeMetrics struct {
	Count         int
	Allowed       int
	Errors        int
	TotalDuration time.Duration
}

type capabilityEvaluationJob struct {
	index int
	check ReviewAttributes
}

type capabilityEvaluationBatch struct {
	service        *Service
	checks         []ReviewAttributes
	results        []CheckResult
	limiter        RateLimiter
	slowThreshold  time.Duration
	now            func() time.Time
	collectMetrics bool

	metricsMu      sync.Mutex
	metricsByScope map[string]*capabilityScopeMetrics
	failureCount   atomic.Int32

	reviewFailureMu  sync.Mutex
	reviewFailures   int
	firstReviewErr   error
	failedIdentities []string
	failedChecks     []sentryreporting.KubernetesRequest
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

	batch := newCapabilityEvaluationBatch(s, checks, results, limiter)
	batch.run(ctx, s.resolveWorkerCount(len(checks)))
	batch.reportReviewFailures()
	batch.reportMetrics()

	if err := ctx.Err(); err != nil {
		return results, err
	}
	if int(batch.failureCount.Load()) == len(checks) {
		return results, fmt.Errorf("all capability checks failed")
	}
	return results, nil
}

func newCapabilityEvaluationBatch(
	service *Service,
	checks []ReviewAttributes,
	results []CheckResult,
	limiter RateLimiter,
) *capabilityEvaluationBatch {
	return &capabilityEvaluationBatch{
		service: service, checks: checks, results: results, limiter: limiter,
		slowThreshold: service.resolveSlowThreshold(), now: service.now,
		collectMetrics: service.deps.Common.Logger != nil,
		metricsByScope: make(map[string]*capabilityScopeMetrics),
	}
}

func (b *capabilityEvaluationBatch) run(ctx context.Context, workerCount int) {
	jobs := make(chan capabilityEvaluationJob)
	var wg sync.WaitGroup
	for range workerCount {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for job := range jobs {
				b.evaluate(ctx, job)
			}
		}()
	}
	for index, check := range b.checks {
		jobs <- capabilityEvaluationJob{index: index, check: check}
	}
	close(jobs)
	wg.Wait()
}

func (b *capabilityEvaluationBatch) evaluate(ctx context.Context, job capabilityEvaluationJob) {
	result := CheckResult{ID: job.check.ID}
	attrs := job.check.Attributes
	if attrs == nil {
		result.Error = "resource attributes missing"
		b.results[job.index] = result
		return
	}
	if b.limiter != nil {
		if err := b.limiter.Wait(ctx); err != nil {
			result.Error = err.Error()
			b.results[job.index] = result
			return
		}
	}

	response, duration, err := b.requestReview(ctx, attrs)
	result = b.reviewResult(result, attrs, response, duration, err)
	b.recordMetrics(attrs.Namespace, result, duration)
	if result.Error != "" || result.EvaluationError != "" {
		b.failureCount.Add(1)
	}
	b.results[job.index] = result
}

func (b *capabilityEvaluationBatch) requestReview(ctx context.Context, attrs *authorizationv1.ResourceAttributes) (*authorizationv1.SelfSubjectAccessReview, time.Duration, error) {
	review := &authorizationv1.SelfSubjectAccessReview{
		Spec: authorizationv1.SelfSubjectAccessReviewSpec{ResourceAttributes: attrs},
	}
	start := b.now()
	var response *authorizationv1.SelfSubjectAccessReview
	err := k8sretry.Do(ctx, capabilityReviewRetryPolicy(), func(callCtx context.Context) error {
		var err error
		response, err = b.service.deps.Common.KubernetesClient.AuthorizationV1().
			SelfSubjectAccessReviews().Create(callCtx, review, metav1.CreateOptions{})
		return err
	})
	return response, b.now().Sub(start), err
}

func (b *capabilityEvaluationBatch) reviewResult(
	result CheckResult,
	attrs *authorizationv1.ResourceAttributes,
	response *authorizationv1.SelfSubjectAccessReview,
	duration time.Duration,
	err error,
) CheckResult {
	if err != nil {
		b.recordReviewFailure(attrs, err)
		result.Error = err.Error()
		return result
	}
	if response == nil {
		result.Error = "permission review returned no response"
		return result
	}
	result.Allowed = response.Status.Allowed
	result.DeniedReason = response.Status.Reason
	result.EvaluationError = response.Status.EvaluationError
	if b.slowThreshold > 0 && duration > b.slowThreshold {
		b.service.logWarn(fmt.Sprintf("Capability check %s slow: %s", describeCapabilityShape(attrs), duration))
	}
	return result
}

func (b *capabilityEvaluationBatch) recordReviewFailure(attrs *authorizationv1.ResourceAttributes, err error) {
	b.reviewFailureMu.Lock()
	defer b.reviewFailureMu.Unlock()
	b.reviewFailures++
	if b.firstReviewErr == nil {
		b.firstReviewErr = err
	}
	if len(b.failedIdentities) < maxReportedFailedChecks {
		b.failedIdentities = append(b.failedIdentities, describeCapabilityShape(attrs))
		b.failedChecks = append(b.failedChecks, capabilityRequest(attrs))
	}
}

func (b *capabilityEvaluationBatch) recordMetrics(namespace string, result CheckResult, duration time.Duration) {
	if !b.collectMetrics {
		return
	}
	b.metricsMu.Lock()
	defer b.metricsMu.Unlock()
	scopeKey := capabilityScopeMetricKey(namespace)
	metric := b.metricsByScope[scopeKey]
	if metric == nil {
		metric = &capabilityScopeMetrics{}
		b.metricsByScope[scopeKey] = metric
	}
	metric.Count++
	if result.Allowed {
		metric.Allowed++
	}
	if result.Error != "" || result.EvaluationError != "" {
		metric.Errors++
	}
	metric.TotalDuration += duration
}

func (b *capabilityEvaluationBatch) reportReviewFailures() {
	if b.reviewFailures == 0 {
		return
	}
	b.service.logError(b.firstReviewErr, fmt.Sprintf(
		"%d of %d capability checks failed: %v [%s]",
		b.reviewFailures, len(b.checks), b.firstReviewErr,
		strings.Join(b.failedIdentities, ", "),
	), sentryreporting.NewKubernetesCapabilityBatchOperation(b.reviewFailures, len(b.checks), b.failedChecks))
}

func (b *capabilityEvaluationBatch) reportMetrics() {
	if !b.collectMetrics {
		return
	}
	snapshot := make(map[string]capabilityScopeMetrics, len(b.metricsByScope))
	for scopeType, metric := range b.metricsByScope {
		snapshot[scopeType] = *metric
	}
	b.service.logScopeMetrics(snapshot)
}

func capabilityReviewRetryPolicy() k8sretry.Policy {
	return k8sretry.Policy{
		MaxAttempts:    config.PermissionReviewRetryMaxAttempts,
		InitialBackoff: config.PermissionReviewRetryInitialBackoff,
		MaxBackoff:     config.PermissionReviewRetryMaxBackoff,
	}
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

// maxReportedFailedChecks bounds the identity list so a cluster-wide failure
// cannot bloat the report payload. The total is reported separately.
const maxReportedFailedChecks = 10

// describeCapabilityShape keeps capability diagnostics useful without logging
// caller-supplied IDs, namespaces, or object names into telemetry-bound text.
func describeCapabilityShape(attrs *authorizationv1.ResourceAttributes) string {
	if attrs == nil {
		return "unknown"
	}
	groupVersion := attrs.Group
	if groupVersion == "" {
		groupVersion = attrs.Version
	} else if attrs.Version != "" {
		groupVersion += "/" + attrs.Version
	}
	resource := attrs.Resource
	if attrs.Subresource != "" {
		resource += "/" + attrs.Subresource
	}
	scope := "cluster-scoped"
	if attrs.Namespace != "" {
		scope = "namespace-scoped"
	}
	parts := []string{groupVersion, resource, attrs.Verb, scope}
	rendered := make([]string, 0, len(parts))
	for _, part := range parts {
		if part != "" {
			rendered = append(rendered, part)
		}
	}
	return strings.Join(rendered, " ")
}

func capabilityRequest(attrs *authorizationv1.ResourceAttributes) sentryreporting.KubernetesRequest {
	if attrs == nil {
		return sentryreporting.KubernetesRequest{}
	}
	scope := sentryreporting.KubernetesScopeCluster
	if attrs.Namespace != "" {
		scope = sentryreporting.KubernetesScopeNamespaced
	}
	return sentryreporting.KubernetesRequest{
		Action:      sentryreporting.KubernetesAction(attrs.Verb),
		Group:       attrs.Group,
		Version:     attrs.Version,
		Resource:    attrs.Resource,
		Subresource: attrs.Subresource,
		Scope:       scope,
	}
}

func (s *Service) logError(err error, message string, operations ...sentryreporting.Operation) {
	if len(operations) > 0 {
		applog.ReportErrorWithOperation(s.deps.Common.Logger, err, message, operations[0], "Capabilities")
		return
	}
	applog.ReportError(s.deps.Common.Logger, err, message, "Capabilities")
}

func (s *Service) logWarn(message string) {
	applog.Warn(s.deps.Common.Logger, message, "Capabilities")
}

func (s *Service) logDebug(message string) {
	applog.Debug(s.deps.Common.Logger, message, "Capabilities")
}

func (s *Service) resolveWorkerCount(requestCount int) int {
	if requestCount <= 0 {
		return 0
	}
	count := s.deps.WorkerCount
	if count <= 0 {
		count = config.AuthorizationReviewWorkerCount
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
	return config.AuthorizationReviewSlowThreshold
}

func (s *Service) buildRateLimiter() RateLimiter {
	if s.deps.RateLimiter != nil {
		return s.deps.RateLimiter
	}
	qps := s.deps.RequestsPerSecond
	if qps <= 0 {
		qps = config.AuthorizationReviewRequestsPerSecond
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

func capabilityScopeMetricKey(namespace string) string {
	if strings.TrimSpace(namespace) == "" {
		return "<cluster>"
	}
	return "<namespace>"
}

func (s *Service) logScopeMetrics(metrics map[string]capabilityScopeMetrics) {
	if len(metrics) == 0 {
		return
	}

	entries := make([]string, 0, len(metrics))
	for scopeType, data := range metrics {
		avg := time.Duration(0)
		if data.Count > 0 {
			avg = data.TotalDuration / time.Duration(data.Count)
		}
		entry := fmt.Sprintf("scope=%s count=%d allowed=%d errors=%d avg=%s", scopeType, data.Count, data.Allowed, data.Errors, avg)
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
