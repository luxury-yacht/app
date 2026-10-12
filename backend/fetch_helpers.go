package backend

import (
	"context"
	"fmt"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/errorstatus"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/internal/timeutil"
)

// contextSleep allows tests to stub or override; defaults to a context-aware sleep.
var contextSleep = timeutil.SleepWithContext

type resourceRetryLogger interface {
	Warn(string, ...string)
}

type resourceRetryDependencies struct {
	recordSuccess func(string)
	recordFailure func(string, string, error)
	telemetry     func() resourceRetryTelemetry
	logger        resourceRetryLogger
	clusterName   func(string) string
}

func executeWithRetry[T any](ctx context.Context, dependencies resourceRetryDependencies, clusterID, resourceKind, target string, fetchFunc func(context.Context) (T, error)) (T, error) {
	var zero T
	if ctx == nil {
		ctx = context.Background()
	}
	if fetchFunc == nil {
		return zero, fmt.Errorf("fetch function not provided")
	}
	if target == "" {
		target = "cluster scope"
	}
	operation := fetchRetryOperation[T]{
		dependencies: dependencies, clusterID: clusterID, resourceKind: resourceKind, target: target, fetch: fetchFunc,
	}
	return operation.run(ctx)
}

type fetchRetryOperation[T any] struct {
	dependencies resourceRetryDependencies
	clusterID    string
	resourceKind string
	target       string
	fetch        func(context.Context) (T, error)
}

func (o fetchRetryOperation[T]) run(ctx context.Context) (T, error) {
	var zero T
	for attempt := 0; attempt < config.ResourceFetchMaxAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return zero, err
		}
		result, err := o.fetch(ctx)
		if err == nil {
			o.recordSuccess(attempt)
			return result, nil
		}
		retryable, reason := errorstatus.Transient(err)
		if retryable && attempt < config.ResourceFetchMaxAttempts-1 {
			if err := o.waitForRetry(ctx, attempt, reason, err); err != nil {
				return zero, err
			}
			continue
		}
		o.recordTerminalError(retryable, reason, err)
		return zero, err
	}
	return zero, fmt.Errorf("exceeded retry attempts for %s %s", o.resourceKind, o.target)
}

func (o fetchRetryOperation[T]) recordSuccess(attempt int) {
	if o.clusterID != "" && o.dependencies.recordSuccess != nil {
		o.dependencies.recordSuccess(o.clusterID)
	}
	if telemetry := o.retryTelemetry(); attempt > 0 && telemetry != nil {
		telemetry.RecordRetrySuccess()
	}
}

func (o fetchRetryOperation[T]) waitForRetry(ctx context.Context, attempt int, reason string, fetchErr error) error {
	backoff := resourceFetchRetryBackoff(attempt)
	o.recordRetryAttempt(attempt, reason, fetchErr)
	return contextSleep(ctx, backoff)
}

func resourceFetchRetryBackoff(attempt int) time.Duration {
	backoff := config.ResourceFetchRetryBaseDelay << attempt
	if backoff > config.ResourceFetchRetryMaxDelay {
		return config.ResourceFetchRetryMaxDelay
	}
	return backoff
}

func (o fetchRetryOperation[T]) recordRetryAttempt(attempt int, reason string, fetchErr error) {
	if o.dependencies.logger != nil {
		clusterName := o.clusterID
		if o.dependencies.clusterName != nil {
			clusterName = o.dependencies.clusterName(o.clusterID)
		}
		o.dependencies.logger.Warn(
			fmt.Sprintf(
				"Retrying %s %s due to %s (attempt %d/%d)",
				o.resourceKind, o.target, reason, attempt+1, config.ResourceFetchMaxAttempts-1,
			),
			logsources.ResourceLoader, o.clusterID, clusterName,
		)
	}
	if telemetry := o.retryTelemetry(); telemetry != nil {
		telemetry.RecordRetryAttempt(fetchErr)
	}
}

func (o fetchRetryOperation[T]) recordTerminalError(retryable bool, reason string, fetchErr error) {
	if !retryable {
		o.recordNonRetryableTransportSuccess()
		return
	}
	if telemetry := o.retryTelemetry(); telemetry != nil {
		telemetry.RecordRetryExhausted(fetchErr)
	}
	if o.clusterID != "" && o.dependencies.recordFailure != nil {
		o.dependencies.recordFailure(o.clusterID, reason, fetchErr)
	}
}

func (o fetchRetryOperation[T]) recordNonRetryableTransportSuccess() {
	if o.clusterID != "" && o.dependencies.recordSuccess != nil {
		o.dependencies.recordSuccess(o.clusterID)
	}
}

func (o fetchRetryOperation[T]) retryTelemetry() resourceRetryTelemetry {
	if o.dependencies.telemetry == nil {
		return nil
	}
	return o.dependencies.telemetry()
}
