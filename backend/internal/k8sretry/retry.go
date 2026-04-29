package k8sretry

import (
	"context"
	"errors"
	"net"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

// Policy controls bounded retries for Kubernetes API calls.
type Policy struct {
	MaxAttempts    int
	InitialBackoff time.Duration
	MaxBackoff     time.Duration
}

// Do retries fn for Kubernetes throttling and transient timeout errors.
func Do(ctx context.Context, policy Policy, fn func(context.Context) error) error {
	if ctx == nil {
		ctx = context.Background()
	}
	if fn == nil {
		return nil
	}
	maxAttempts := policy.MaxAttempts
	if maxAttempts <= 0 {
		maxAttempts = 1
	}

	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		err := fn(ctx)
		if err == nil {
			return nil
		}
		lastErr = err
		if attempt == maxAttempts-1 || !IsRetryable(err) {
			return err
		}
		if err := sleep(ctx, retryDelay(err, attempt, policy)); err != nil {
			return err
		}
	}
	return lastErr
}

// IsRetryable reports whether err represents a transient Kubernetes API condition.
func IsRetryable(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return false
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return true
	}
	return apierrors.IsTooManyRequests(err) || apierrors.IsTimeout(err) || apierrors.IsServerTimeout(err)
}

func retryDelay(err error, attempt int, policy Policy) time.Duration {
	maxBackoff := policy.MaxBackoff
	if maxBackoff <= 0 {
		maxBackoff = time.Second
	}
	if seconds, ok := apierrors.SuggestsClientDelay(err); ok && seconds > 0 {
		delay := time.Duration(seconds) * time.Second
		if delay > maxBackoff {
			return maxBackoff
		}
		return delay
	}

	delay := policy.InitialBackoff
	if delay <= 0 {
		delay = 100 * time.Millisecond
	}
	for range attempt {
		delay *= 2
		if delay >= maxBackoff {
			return maxBackoff
		}
	}
	return delay
}

func sleep(ctx context.Context, delay time.Duration) error {
	if delay <= 0 {
		return nil
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
