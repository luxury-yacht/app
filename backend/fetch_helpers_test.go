package backend

import (
	"context"
	"errors"
	"io"
	"net/url"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"

	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"github.com/stretchr/testify/require"
)

func TestExecuteWithRetryRetriesTransientErrorAndRecordsTelemetry(t *testing.T) {
	recorder := telemetry.NewRecorder()
	originalSleep := contextSleep
	contextSleep = func(context.Context, time.Duration) error { return nil }
	t.Cleanup(func() { contextSleep = originalSleep })

	callCount := 0
	value, err := executeWithRetry(
		context.Background(),
		resourceRetryDependencies{telemetry: func() resourceRetryTelemetry { return recorder }},
		"cluster-a", "Widget", "default/foo",
		func(context.Context) (string, error) {
			callCount++
			if callCount == 1 {
				return "", &url.Error{Err: errors.New("connection refused"), Op: "GET", URL: "https://cluster"}
			}
			return "ok", nil
		},
	)

	require.NoError(t, err)
	require.Equal(t, "ok", value)
	require.Equal(t, 2, callCount)
	summary := recorder.SnapshotSummary()
	require.Equal(t, uint64(1), summary.Connection.RetryAttempts)
	require.Equal(t, uint64(1), summary.Connection.RetrySuccesses)
	require.Equal(t, uint64(0), summary.Connection.RetryExhausted)
}

func TestExecuteWithRetryExhaustsAttemptsAndRecordsFailure(t *testing.T) {
	recorder := telemetry.NewRecorder()
	var failures []string
	originalSleep := contextSleep
	contextSleep = func(context.Context, time.Duration) error { return nil }
	t.Cleanup(func() { contextSleep = originalSleep })

	callCount := 0
	_, err := executeWithRetry(
		context.Background(),
		resourceRetryDependencies{
			telemetry:     func() resourceRetryTelemetry { return recorder },
			recordFailure: func(clusterID, _ string, _ error) { failures = append(failures, clusterID) },
		},
		"cluster-a", "Widget", "default/foo",
		func(context.Context) (string, error) {
			callCount++
			return "", &url.Error{Err: errors.New("connection refused"), Op: "GET", URL: "https://cluster"}
		},
	)

	require.Error(t, err)
	require.Equal(t, config.ResourceFetchMaxAttempts, callCount)
	require.Equal(t, []string{"cluster-a"}, failures, "an exhausted transient failure marks the cluster's transport unhealthy")
	summary := recorder.SnapshotSummary()
	require.Equal(t, uint64(config.ResourceFetchMaxAttempts-1), summary.Connection.RetryAttempts)
	require.Equal(t, uint64(0), summary.Connection.RetrySuccesses)
	require.Equal(t, uint64(1), summary.Connection.RetryExhausted)
}

func TestExecuteWithRetryValidatesInputs(t *testing.T) {
	_, err := executeWithRetry[string](context.Background(), resourceRetryDependencies{}, "", "Widget", "", nil)
	require.ErrorContains(t, err, "fetch function not provided")

	value, err := executeWithRetry[string](context.Background(), resourceRetryDependencies{}, "", "Widget", "", func(context.Context) (string, error) {
		return "ok", nil
	})
	require.NoError(t, err)
	require.Equal(t, "ok", value)
}

func TestExecuteWithRetryWithoutOptionalCallbacksUsesConfiguredSleep(t *testing.T) {
	originalSleep := contextSleep
	var delays []time.Duration
	contextSleep = func(_ context.Context, delay time.Duration) error {
		delays = append(delays, delay)
		return nil
	}
	t.Cleanup(func() { contextSleep = originalSleep })

	attempts := 0
	value, err := executeWithRetry(context.Background(), resourceRetryDependencies{}, "cluster-a", "Widget", "demo", func(context.Context) (string, error) {
		attempts++
		if attempts == 1 {
			return "", io.EOF
		}
		return "ok", nil
	})

	require.NoError(t, err)
	require.Equal(t, "ok", value)
	require.Equal(t, []time.Duration{config.ResourceFetchRetryBaseDelay}, delays)
}

func TestExecuteWithRetryWithoutLoggerUsesContextSleepAndRecordsTelemetry(t *testing.T) {
	recorder := telemetry.NewRecorder()
	sleepErr := errors.New("sleep interrupted")
	originalContextSleep := contextSleep
	contextSleep = func(context.Context, time.Duration) error { return sleepErr }
	t.Cleanup(func() { contextSleep = originalContextSleep })

	_, err := executeWithRetry(
		context.Background(),
		resourceRetryDependencies{telemetry: func() resourceRetryTelemetry { return recorder }},
		"cluster-a",
		"Widget",
		"demo",
		func(context.Context) (string, error) { return "", io.EOF },
	)

	require.ErrorIs(t, err, sleepErr)
	require.Equal(t, uint64(1), recorder.SnapshotSummary().Connection.RetryAttempts)
}

func TestExecuteWithRetryReturnsContextSleepFailure(t *testing.T) {
	sleepErr := errors.New("sleep interrupted")
	originalSleep := contextSleep
	contextSleep = func(context.Context, time.Duration) error { return sleepErr }
	t.Cleanup(func() { contextSleep = originalSleep })

	_, err := executeWithRetry(context.Background(), resourceRetryDependencies{}, "cluster-a", "Widget", "demo", func(context.Context) (string, error) {
		return "", io.EOF
	})
	require.ErrorIs(t, err, sleepErr)
}

func TestExecuteWithRetryAbortsSlowFetcherAtDeadline(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()

	startedAt := time.Now()
	_, err := executeWithRetry(ctx, resourceRetryDependencies{}, "cluster-a", "Widget", "demo", func(fetchCtx context.Context) (string, error) {
		<-fetchCtx.Done()
		return "", fetchCtx.Err()
	})

	require.ErrorIs(t, err, context.DeadlineExceeded)
	require.Less(t, time.Since(startedAt), time.Second)
}

func TestExecuteWithRetryWithoutOptionalCallbacksDoesNotRetryPermanentError(t *testing.T) {
	attempts := 0
	permanent := errors.New("validation failed")
	_, err := executeWithRetry(context.Background(), resourceRetryDependencies{}, "cluster-a", "Widget", "demo", func(context.Context) (string, error) {
		attempts++
		return "", permanent
	})

	require.ErrorIs(t, err, permanent)
	require.Equal(t, 1, attempts)
}

func TestResourceFetchRetryBackoffCapsAtConfiguredMaximum(t *testing.T) {
	require.Equal(t, config.ResourceFetchRetryMaxDelay, resourceFetchRetryBackoff(30))
}

// Tests for ensureClientInitialized and ensureAPIExtensionsClientInitialized have been removed.
// These helper functions were deleted as part of removing global client fields.
// Client initialization checks are now done via ensureDependenciesInitialized which
// takes explicit Dependencies and does not rely on App-level global fields.
