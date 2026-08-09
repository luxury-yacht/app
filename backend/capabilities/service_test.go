package capabilities

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/resources/common"
	authorizationv1 "k8s.io/api/authorization/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	cgotesting "k8s.io/client-go/testing"
)

type captureLogger struct {
	debugs []string
	warns  []string
	errors []string
	cause  error
}

func (l *captureLogger) Debug(message string, _ ...string) { l.debugs = append(l.debugs, message) }
func (l *captureLogger) Info(string, ...string)            {}
func (l *captureLogger) Warn(message string, _ ...string)  { l.warns = append(l.warns, message) }
func (l *captureLogger) Error(message string, _ ...string) { l.errors = append(l.errors, message) }
func (l *captureLogger) ErrorWithCause(err error, message string, _ ...string) {
	l.cause = err
	l.errors = append(l.errors, fmt.Sprintf("%s: %v", message, err))
}

type stubRateLimiter struct {
	waits int
	err   error
}

func (s *stubRateLimiter) Wait(ctx context.Context) error {
	s.waits++
	if s.err != nil {
		return s.err
	}
	return nil
}

func (s *stubRateLimiter) Stop() {}

func TestEvaluateAllowed(t *testing.T) {
	client := fake.NewClientset()
	client.Fake.PrependReactor("create", "selfsubjectaccessreviews", func(action cgotesting.Action) (bool, runtime.Object, error) {
		createAction := action.(cgotesting.CreateAction)
		review := createAction.GetObject().(*authorizationv1.SelfSubjectAccessReview)
		review.Status = authorizationv1.SubjectAccessReviewStatus{
			Allowed: true,
			Reason:  "allowed by test",
		}
		return true, review, nil
	})

	service := NewService(Dependencies{
		Common: common.Dependencies{
			Logger:           applog.Noop,
			KubernetesClient: client,
		},
	})

	checks := []ReviewAttributes{{
		ID: "update",
		Attributes: &authorizationv1.ResourceAttributes{
			Verb:      "update",
			Group:     "apps",
			Resource:  "deployments",
			Namespace: "default",
			Name:      "demo",
		},
	}}

	results, err := service.Evaluate(context.Background(), checks)
	if err != nil {
		t.Fatalf("Evaluate returned error: %v", err)
	}

	if len(results) != 1 {
		t.Fatalf("Expected 1 result, got %d", len(results))
	}

	if !results[0].Allowed {
		t.Fatalf("Expected result to be allowed, got %+v", results[0])
	}

	if results[0].DeniedReason != "allowed by test" {
		t.Fatalf("Unexpected denied reason: %s", results[0].DeniedReason)
	}
}

func TestEvaluateSlowWarningOmitsCallerIDAndResourceNames(t *testing.T) {
	client := fake.NewClientset()
	client.Fake.PrependReactor("create", "selfsubjectaccessreviews", func(action cgotesting.Action) (bool, runtime.Object, error) {
		review := action.(cgotesting.CreateAction).GetObject().(*authorizationv1.SelfSubjectAccessReview)
		review.Status = authorizationv1.SubjectAccessReviewStatus{Allowed: true}
		return true, review, nil
	})

	logger := &captureLogger{}
	start := time.Date(2026, time.August, 3, 12, 0, 0, 0, time.UTC)
	times := []time.Time{start, start.Add(2 * time.Second)}
	timeIndex := 0
	service := NewService(Dependencies{
		Common: common.Dependencies{
			Logger:           logger,
			KubernetesClient: client,
		},
		WorkerCount:          1,
		SlowRequestThreshold: time.Second,
		Now: func() time.Time {
			current := times[timeIndex]
			timeIndex++
			return current
		},
	})
	callerID := "cluster-1|apps/v1|deployment|list|customer-prod|"

	_, err := service.Evaluate(context.Background(), []ReviewAttributes{{
		ID: callerID,
		Attributes: &authorizationv1.ResourceAttributes{
			Group:     "apps",
			Version:   "v1",
			Resource:  "deployments",
			Verb:      "list",
			Namespace: "customer-prod",
			Name:      "private-web",
		},
	}})

	if err != nil {
		t.Fatalf("Evaluate returned error: %v", err)
	}
	if len(logger.warns) != 1 {
		t.Fatalf("expected one slow warning, got %v", logger.warns)
	}
	warning := logger.warns[0]
	if strings.Contains(warning, callerID) || strings.Contains(warning, "customer-prod") || strings.Contains(warning, "private-web") {
		t.Fatalf("slow warning leaked a caller id, namespace, or resource name: %q", warning)
	}
	if !strings.Contains(warning, "apps/v1 deployments list namespace-scoped") {
		t.Fatalf("expected structural check details to remain actionable, got %q", warning)
	}
}

// A dropped connection fails every in-flight review at once. Logging each one
// turns a single fault into an ERROR per check, and every backend ERROR is
// forwarded to error reporting.
func TestEvaluateLogsOneSummaryWhenEveryReviewFails(t *testing.T) {
	client := fake.NewClientset()
	client.Fake.PrependReactor("create", "selfsubjectaccessreviews", func(cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("http2: client connection lost")
	})

	logger := &captureLogger{}
	service := NewService(Dependencies{
		Common: common.Dependencies{
			Logger:           logger,
			KubernetesClient: client,
		},
	})

	checks := make([]ReviewAttributes, 0, 12)
	for i := range 12 {
		checks = append(checks, ReviewAttributes{
			ID: fmt.Sprintf("check-%d", i),
			Attributes: &authorizationv1.ResourceAttributes{
				Verb:     "update",
				Group:    "apps",
				Resource: "deployments",
			},
		})
	}

	if _, err := service.Evaluate(context.Background(), checks); err == nil {
		t.Fatalf("expected Evaluate to report that every check failed")
	}

	if len(logger.errors) != 1 {
		t.Fatalf("expected exactly 1 error log for the batch, got %d: %v", len(logger.errors), logger.errors)
	}
	summary := logger.errors[0]
	if !strings.Contains(summary, "12 of 12") {
		t.Fatalf("expected the summary to report the failure count, got %q", summary)
	}
	if !strings.Contains(summary, "http2: client connection lost") {
		t.Fatalf("expected the summary to carry the underlying cause, got %q", summary)
	}
	if logger.cause == nil || logger.cause.Error() != "http2: client connection lost" {
		t.Fatalf("expected the original review error, got %v", logger.cause)
	}
}

// The count alone cannot say which checks broke. Keep the structural resource
// identity, but never put namespace or object names into telemetry-bound text.
func TestEvaluateSummaryDescribesFailedChecksWithoutResourceNames(t *testing.T) {
	client := fake.NewClientset()
	client.Fake.PrependReactor("create", "selfsubjectaccessreviews", func(action cgotesting.Action) (bool, runtime.Object, error) {
		review := action.(cgotesting.CreateAction).GetObject().(*authorizationv1.SelfSubjectAccessReview)
		if review.Spec.ResourceAttributes.Resource == "secrets" {
			return true, nil, errors.New("etcdserver: request timed out")
		}
		review.Status = authorizationv1.SubjectAccessReviewStatus{Allowed: true}
		return true, review, nil
	})

	logger := &captureLogger{}
	service := NewService(Dependencies{Common: common.Dependencies{
		Logger: logger, KubernetesClient: client,
	}})

	checks := []ReviewAttributes{
		{ID: "ok", Attributes: &authorizationv1.ResourceAttributes{Verb: "get", Resource: "pods"}},
		{ID: "bad", Attributes: &authorizationv1.ResourceAttributes{
			Version: "v1", Resource: "secrets", Verb: "update", Namespace: "prod", Name: "tls",
		}},
	}

	if _, err := service.Evaluate(context.Background(), checks); err != nil {
		t.Fatalf("Evaluate returned error for a partial failure: %v", err)
	}

	if len(logger.errors) != 1 {
		t.Fatalf("expected exactly 1 error log, got %d: %v", len(logger.errors), logger.errors)
	}
	summary := logger.errors[0]
	if !strings.Contains(summary, "v1 secrets update namespace-scoped") {
		t.Fatalf("expected structural failed-check details in the summary, got %q", summary)
	}
	if strings.Contains(summary, "prod") || strings.Contains(summary, "tls") {
		t.Fatalf("expected namespace and object names to be omitted, got %q", summary)
	}
	if strings.Contains(summary, "pods") {
		t.Fatalf("expected only failed checks to be named, got %q", summary)
	}
}

// Sentry truncates long titles. The cause is the part you cannot reconstruct
// from anywhere else, so it has to precede the identity list or a wide failure
// scrolls it off the end.
func TestEvaluateSummaryPutsTheCauseBeforeTheIdentities(t *testing.T) {
	client := fake.NewClientset()
	client.Fake.PrependReactor("create", "selfsubjectaccessreviews", func(cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("connection lost")
	})

	logger := &captureLogger{}
	service := NewService(Dependencies{Common: common.Dependencies{
		Logger: logger, KubernetesClient: client,
	}})

	// Namespace-scoped checks keep their scope type, never the namespace value.
	checks := []ReviewAttributes{{ID: "list", Attributes: &authorizationv1.ResourceAttributes{
		Verb: "list", Resource: "pods", Namespace: "fa-jj-test",
	}}}

	if _, err := service.Evaluate(context.Background(), checks); err == nil {
		t.Fatal("expected Evaluate to report the failure")
	}

	summary := logger.errors[0]
	if strings.Contains(summary, "fa-jj-test") {
		t.Fatalf("expected the namespace value to be omitted, got %q", summary)
	}
	if !strings.Contains(summary, "pods list namespace-scoped") {
		t.Fatalf("expected the namespace scope type to remain, got %q", summary)
	}
	causeAt := strings.Index(summary, "connection lost")
	listAt := strings.Index(summary, "pods list")
	if causeAt < 0 || listAt < 0 {
		t.Fatalf("expected both the cause and the identities, got %q", summary)
	}
	if causeAt > listAt {
		t.Fatalf("expected the cause before the identity list, got %q", summary)
	}
}

func TestEvaluateSummaryCountsOnlyTheFailedReviews(t *testing.T) {
	client := fake.NewClientset()
	client.Fake.PrependReactor("create", "selfsubjectaccessreviews", func(action cgotesting.Action) (bool, runtime.Object, error) {
		review := action.(cgotesting.CreateAction).GetObject().(*authorizationv1.SelfSubjectAccessReview)
		if review.Spec.ResourceAttributes.Resource == "secrets" {
			return true, nil, errors.New("http2: client connection lost")
		}
		review.Status = authorizationv1.SubjectAccessReviewStatus{Allowed: true}
		return true, review, nil
	})

	logger := &captureLogger{}
	service := NewService(Dependencies{
		Common: common.Dependencies{
			Logger:           logger,
			KubernetesClient: client,
		},
	})

	checks := []ReviewAttributes{
		{ID: "ok-1", Attributes: &authorizationv1.ResourceAttributes{Verb: "get", Resource: "pods"}},
		{ID: "bad-1", Attributes: &authorizationv1.ResourceAttributes{Verb: "get", Resource: "secrets"}},
		{ID: "ok-2", Attributes: &authorizationv1.ResourceAttributes{Verb: "get", Resource: "pods"}},
	}

	if _, err := service.Evaluate(context.Background(), checks); err != nil {
		t.Fatalf("Evaluate returned error for a partial failure: %v", err)
	}

	if len(logger.errors) != 1 {
		t.Fatalf("expected exactly 1 error log, got %d: %v", len(logger.errors), logger.errors)
	}
	if !strings.Contains(logger.errors[0], "1 of 3") {
		t.Fatalf("expected the summary to count only failed reviews, got %q", logger.errors[0])
	}
}

func TestEvaluateLogsNothingWhenEveryReviewSucceeds(t *testing.T) {
	client := fake.NewClientset()
	client.Fake.PrependReactor("create", "selfsubjectaccessreviews", func(action cgotesting.Action) (bool, runtime.Object, error) {
		review := action.(cgotesting.CreateAction).GetObject().(*authorizationv1.SelfSubjectAccessReview)
		review.Status = authorizationv1.SubjectAccessReviewStatus{Allowed: true}
		return true, review, nil
	})

	logger := &captureLogger{}
	service := NewService(Dependencies{
		Common: common.Dependencies{
			Logger:           logger,
			KubernetesClient: client,
		},
	})

	checks := []ReviewAttributes{
		{ID: "ok-1", Attributes: &authorizationv1.ResourceAttributes{Verb: "get", Resource: "pods"}},
	}

	if _, err := service.Evaluate(context.Background(), checks); err != nil {
		t.Fatalf("Evaluate returned error: %v", err)
	}

	if len(logger.errors) != 0 {
		t.Fatalf("expected no error logs, got %v", logger.errors)
	}
}

func TestEvaluateDenied(t *testing.T) {
	client := fake.NewClientset()
	client.Fake.PrependReactor("create", "selfsubjectaccessreviews", func(action cgotesting.Action) (bool, runtime.Object, error) {
		createAction := action.(cgotesting.CreateAction)
		review := createAction.GetObject().(*authorizationv1.SelfSubjectAccessReview)
		review.Status = authorizationv1.SubjectAccessReviewStatus{
			Allowed: false,
			Reason:  "denied by cluster policy",
		}
		return true, review, nil
	})

	service := NewService(Dependencies{
		Common: common.Dependencies{
			Logger:           applog.Noop,
			KubernetesClient: client,
		},
	})

	checks := []ReviewAttributes{{
		ID: "delete",
		Attributes: &authorizationv1.ResourceAttributes{
			Verb:      "delete",
			Group:     "",
			Resource:  "namespaces",
			Namespace: "",
			Name:      "prod",
		},
	}}

	results, err := service.Evaluate(context.Background(), checks)
	if err != nil {
		t.Fatalf("Evaluate returned error: %v", err)
	}

	if len(results) != 1 {
		t.Fatalf("Expected 1 result, got %d", len(results))
	}

	if results[0].Allowed {
		t.Fatalf("Expected result to be denied, got %+v", results[0])
	}

	if results[0].DeniedReason != "denied by cluster policy" {
		t.Fatalf("Unexpected denied reason: %s", results[0].DeniedReason)
	}
}

func TestEvaluateHandlesAPIError(t *testing.T) {
	client := fake.NewClientset()
	client.Fake.PrependReactor("create", "selfsubjectaccessreviews", func(action cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("cluster unavailable")
	})

	service := NewService(Dependencies{
		Common: common.Dependencies{
			Logger:           applog.Noop,
			KubernetesClient: client,
		},
	})

	checks := []ReviewAttributes{{
		ID: "patch",
		Attributes: &authorizationv1.ResourceAttributes{
			Verb:      "patch",
			Group:     "apps",
			Resource:  "deployments",
			Namespace: "default",
			Name:      "demo",
		},
	}}

	results, err := service.Evaluate(context.Background(), checks)
	if err == nil {
		t.Fatalf("expected aggregate error when all SAR calls fail")
	}

	if len(results) != 1 {
		t.Fatalf("Expected 1 result, got %d", len(results))
	}

	if results[0].Error == "" {
		t.Fatalf("Expected error to be recorded, got %+v", results[0])
	}
}

func TestEvaluateRetriesTransientAuthorizationError(t *testing.T) {
	client := fake.NewClientset()
	calls := 0
	client.Fake.PrependReactor("create", "selfsubjectaccessreviews", func(action cgotesting.Action) (bool, runtime.Object, error) {
		calls++
		if calls == 1 {
			return true, nil, apierrors.NewTooManyRequests("busy", 0)
		}
		review := action.(cgotesting.CreateAction).GetObject().(*authorizationv1.SelfSubjectAccessReview)
		review.Status = authorizationv1.SubjectAccessReviewStatus{Allowed: true}
		return true, review, nil
	})

	service := NewService(Dependencies{
		Common: common.Dependencies{
			Logger:           applog.Noop,
			KubernetesClient: client,
		},
		WorkerCount: 1,
	})

	results, err := service.Evaluate(context.Background(), []ReviewAttributes{{
		ID: "get",
		Attributes: &authorizationv1.ResourceAttributes{
			Verb:     "get",
			Resource: "pods",
		},
	}})
	if err != nil {
		t.Fatalf("Evaluate returned error: %v", err)
	}
	if calls != 2 {
		t.Fatalf("expected 2 SSAR calls, got %d", calls)
	}
	if len(results) != 1 || !results[0].Allowed {
		t.Fatalf("expected retried result to be allowed, got %+v", results)
	}
}

func TestEvaluateUsesRateLimiter(t *testing.T) {
	client := fake.NewClientset()
	client.Fake.PrependReactor("create", "selfsubjectaccessreviews", func(action cgotesting.Action) (bool, runtime.Object, error) {
		review := action.(cgotesting.CreateAction).GetObject().(*authorizationv1.SelfSubjectAccessReview)
		review.Status = authorizationv1.SubjectAccessReviewStatus{Allowed: true}
		return true, review, nil
	})

	limiter := &stubRateLimiter{}

	service := NewService(Dependencies{
		Common: common.Dependencies{
			Logger:           applog.Noop,
			KubernetesClient: client,
		},
		RateLimiter: limiter,
		WorkerCount: 1,
	})

	checks := []ReviewAttributes{
		{
			ID: "get-a",
			Attributes: &authorizationv1.ResourceAttributes{
				Verb:     "get",
				Resource: "pods",
			},
		},
		{
			ID: "get-b",
			Attributes: &authorizationv1.ResourceAttributes{
				Verb:     "get",
				Resource: "pods",
			},
		},
	}

	results, err := service.Evaluate(context.Background(), checks)
	if err != nil {
		t.Fatalf("Evaluate returned error: %v", err)
	}

	if limiter.waits != len(checks) {
		t.Fatalf("expected rate limiter to be invoked %d times, got %d", len(checks), limiter.waits)
	}

	for i, result := range results {
		if !result.Allowed {
			t.Fatalf("expected result %d to be allowed, got %+v", i, result)
		}
	}
}

func TestLogHelpersRespectLogger(t *testing.T) {
	logger := &captureLogger{}
	svc := NewService(Dependencies{
		Common: common.Dependencies{
			Logger: logger,
		},
	})

	svc.logWarn("warn")
	svc.logError(errors.New("cause"), "error")
	svc.logDebug("debug")

	if len(logger.warns) != 1 || logger.warns[0] != "warn" {
		t.Fatalf("expected warn to be recorded, got %+v", logger.warns)
	}
	if len(logger.errors) != 1 || logger.errors[0] != "error: cause" {
		t.Fatalf("expected error to be recorded, got %+v", logger.errors)
	}
	if len(logger.debugs) != 1 || logger.debugs[0] != "debug" {
		t.Fatalf("expected debug to be recorded, got %+v", logger.debugs)
	}
}

func TestCapabilityScopeMetricKeyRetainsOnlyScopeType(t *testing.T) {
	if got := capabilityScopeMetricKey("customer-prod"); got != "<namespace>" {
		t.Fatalf("expected a namespace-scoped metric key, got %q", got)
	}
	if got := capabilityScopeMetricKey(""); got != "<cluster>" {
		t.Fatalf("expected a cluster-scoped metric key, got %q", got)
	}
}

func TestResolveWorkerCount(t *testing.T) {
	tests := []struct {
		name         string
		workerCount  int
		requestCount int
		expected     int
	}{
		{"zero requests", 4, 0, 0},
		{"cap by requests", 8, 3, 3},
		{"respect worker override", 2, 10, 2},
		{"fallback to default", 0, 4, 4},
		{"at least one", -1, 1, 1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := NewService(Dependencies{WorkerCount: tt.workerCount})
			got := svc.resolveWorkerCount(tt.requestCount)
			if got != tt.expected {
				t.Fatalf("expected %d, got %d", tt.expected, got)
			}
		})
	}
}

func TestEvaluateSkipsAPICallWhenRateLimiterErrors(t *testing.T) {
	client := fake.NewClientset()
	var apiCalls int
	client.Fake.PrependReactor("create", "selfsubjectaccessreviews", func(action cgotesting.Action) (bool, runtime.Object, error) {
		apiCalls++
		return true, nil, nil
	})

	limiter := &stubRateLimiter{err: errors.New("throttled")}

	service := NewService(Dependencies{
		Common: common.Dependencies{
			Logger:           applog.Noop,
			KubernetesClient: client,
		},
		RateLimiter: limiter,
		WorkerCount: 1,
	})

	checks := []ReviewAttributes{{
		ID: "patch",
		Attributes: &authorizationv1.ResourceAttributes{
			Verb:     "patch",
			Resource: "deployments",
		},
	}}

	results, err := service.Evaluate(context.Background(), checks)
	if err != nil {
		t.Fatalf("unexpected Evaluate error: %v", err)
	}

	if apiCalls != 0 {
		t.Fatalf("expected no API calls when rate limiter errors, got %d", apiCalls)
	}

	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}

	if results[0].Error != "throttled" {
		t.Fatalf("expected throttled error in results, got %+v", results[0])
	}
}
