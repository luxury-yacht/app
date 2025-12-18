package capabilities

import (
	"context"
	"errors"
	"testing"

	"github.com/luxury-yacht/app/backend/resources/common"
	authorizationv1 "k8s.io/api/authorization/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	kubetesting "k8s.io/client-go/testing"
)

type noopLogger struct{}

func (noopLogger) Debug(string, ...string) {}
func (noopLogger) Info(string, ...string)  {}
func (noopLogger) Warn(string, ...string)  {}
func (noopLogger) Error(string, ...string) {}

type captureLogger struct {
	debugs []string
	warns  []string
	errors []string
}

func (l *captureLogger) Debug(message string, _ ...string) { l.debugs = append(l.debugs, message) }
func (l *captureLogger) Info(string, ...string)            {}
func (l *captureLogger) Warn(message string, _ ...string)  { l.warns = append(l.warns, message) }
func (l *captureLogger) Error(message string, _ ...string) { l.errors = append(l.errors, message) }

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
	client := fake.NewSimpleClientset()
	client.Fake.PrependReactor("create", "selfsubjectaccessreviews", func(action kubetesting.Action) (bool, runtime.Object, error) {
		createAction := action.(kubetesting.CreateAction)
		review := createAction.GetObject().(*authorizationv1.SelfSubjectAccessReview)
		review.Status = authorizationv1.SubjectAccessReviewStatus{
			Allowed: true,
			Reason:  "allowed by test",
		}
		return true, review, nil
	})

	service := NewService(Dependencies{
		Common: common.Dependencies{
			Context:          context.Background(),
			Logger:           noopLogger{},
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

func TestEvaluateDenied(t *testing.T) {
	client := fake.NewSimpleClientset()
	client.Fake.PrependReactor("create", "selfsubjectaccessreviews", func(action kubetesting.Action) (bool, runtime.Object, error) {
		createAction := action.(kubetesting.CreateAction)
		review := createAction.GetObject().(*authorizationv1.SelfSubjectAccessReview)
		review.Status = authorizationv1.SubjectAccessReviewStatus{
			Allowed: false,
			Reason:  "denied by cluster policy",
		}
		return true, review, nil
	})

	service := NewService(Dependencies{
		Common: common.Dependencies{
			Context:          context.Background(),
			Logger:           noopLogger{},
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
	client := fake.NewSimpleClientset()
	client.Fake.PrependReactor("create", "selfsubjectaccessreviews", func(action kubetesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("cluster unavailable")
	})

	service := NewService(Dependencies{
		Common: common.Dependencies{
			Context:          context.Background(),
			Logger:           noopLogger{},
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

func TestEvaluateUsesRateLimiter(t *testing.T) {
	client := fake.NewSimpleClientset()
	client.Fake.PrependReactor("create", "selfsubjectaccessreviews", func(action kubetesting.Action) (bool, runtime.Object, error) {
		review := action.(kubetesting.CreateAction).GetObject().(*authorizationv1.SelfSubjectAccessReview)
		review.Status = authorizationv1.SubjectAccessReviewStatus{Allowed: true}
		return true, review, nil
	})

	limiter := &stubRateLimiter{}

	service := NewService(Dependencies{
		Common: common.Dependencies{
			Context:          context.Background(),
			Logger:           noopLogger{},
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
	svc.logError("error")
	svc.logDebug("debug")

	if len(logger.warns) != 1 || logger.warns[0] != "warn" {
		t.Fatalf("expected warn to be recorded, got %+v", logger.warns)
	}
	if len(logger.errors) != 1 || logger.errors[0] != "error" {
		t.Fatalf("expected error to be recorded, got %+v", logger.errors)
	}
	if len(logger.debugs) != 1 || logger.debugs[0] != "debug" {
		t.Fatalf("expected debug to be recorded, got %+v", logger.debugs)
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
		{"fallback to default", 0, 5, 4},
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
	client := fake.NewSimpleClientset()
	var apiCalls int
	client.Fake.PrependReactor("create", "selfsubjectaccessreviews", func(action kubetesting.Action) (bool, runtime.Object, error) {
		apiCalls++
		return true, nil, nil
	})

	limiter := &stubRateLimiter{err: errors.New("throttled")}

	service := NewService(Dependencies{
		Common: common.Dependencies{
			Context:          context.Background(),
			Logger:           noopLogger{},
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
