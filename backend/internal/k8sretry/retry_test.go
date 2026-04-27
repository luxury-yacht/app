package k8sretry

import (
	"context"
	"errors"
	"testing"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func TestDoRetriesTooManyRequests(t *testing.T) {
	attempts := 0
	err := Do(context.Background(), Policy{MaxAttempts: 3}, func(context.Context) error {
		attempts++
		if attempts == 1 {
			return apierrors.NewTooManyRequests("busy", 0)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("expected retry to succeed, got %v", err)
	}
	if attempts != 2 {
		t.Fatalf("expected 2 attempts, got %d", attempts)
	}
}

func TestDoDoesNotRetryPermanentError(t *testing.T) {
	attempts := 0
	permanent := errors.New("forbidden")
	err := Do(context.Background(), Policy{MaxAttempts: 3}, func(context.Context) error {
		attempts++
		return permanent
	})
	if !errors.Is(err, permanent) {
		t.Fatalf("expected permanent error, got %v", err)
	}
	if attempts != 1 {
		t.Fatalf("expected 1 attempt, got %d", attempts)
	}
}

func TestRetryDelayHonorsRetryAfterWithCap(t *testing.T) {
	err := apierrors.NewServerTimeout(schema.GroupResource{Group: "", Resource: "pods"}, "list", 10)
	delay := retryDelay(err, 0, Policy{
		InitialBackoff: 100 * time.Millisecond,
		MaxBackoff:     time.Second,
	})
	if delay != time.Second {
		t.Fatalf("expected retry-after to be capped at 1s, got %s", delay)
	}
}

func TestRetryDelayExponentialBackoff(t *testing.T) {
	err := apierrors.NewTooManyRequests("busy", 0)
	delay := retryDelay(err, 2, Policy{
		InitialBackoff: 100 * time.Millisecond,
		MaxBackoff:     time.Second,
	})
	if delay != 400*time.Millisecond {
		t.Fatalf("expected 400ms delay, got %s", delay)
	}
}
