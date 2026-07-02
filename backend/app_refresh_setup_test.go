/*
 * backend/app_refresh_setup_test.go
 *
 * Tests for refresh subsystem setup orchestration.
 */

package backend

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh/containerlogsstream"
)

// TestBuildSubsystemsInSelectionOrderRunsConcurrentlyAndPreservesOrder pins the two
// contracts of the parallel subsystem build: selections build CONCURRENTLY (multiple
// clusters must not pay the ~seconds-each informer+SSAR construction serially), and
// the assembled outcomes keep SELECTION order so clusterOrder stays deterministic.
func TestBuildSubsystemsInSelectionOrderRunsConcurrentlyAndPreservesOrder(t *testing.T) {
	const n = 3
	entered := make(chan int, n)
	release := make(chan struct{})

	type result struct {
		outcomes []subsystemBuildOutcome
		err      error
	}
	done := make(chan result, 1)
	go func() {
		outcomes, err := buildSubsystemsInSelectionOrder(context.Background(), n, n,
			func(_ context.Context, index int) (subsystemBuildOutcome, error) {
				entered <- index
				// Every builder parks until ALL have entered: a serial
				// implementation deadlocks here and the test times out below.
				<-release
				return subsystemBuildOutcome{id: fmt.Sprintf("cluster-%d", index)}, nil
			})
		done <- result{outcomes: outcomes, err: err}
	}()

	for i := 0; i < n; i++ {
		select {
		case <-entered:
		case <-time.After(2 * time.Second):
			t.Fatalf("only %d of %d builders started: subsystem builds are serial, not concurrent", i, n)
		}
	}
	close(release)

	select {
	case res := <-done:
		if res.err != nil {
			t.Fatalf("build failed: %v", res.err)
		}
		if len(res.outcomes) != n {
			t.Fatalf("expected %d outcomes, got %d", n, len(res.outcomes))
		}
		for i, outcome := range res.outcomes {
			if want := fmt.Sprintf("cluster-%d", i); outcome.id != want {
				t.Fatalf("outcome %d = %q; parallel build must preserve selection order (want %q)", i, outcome.id, want)
			}
		}
	case <-time.After(2 * time.Second):
		t.Fatal("build did not complete after release")
	}
}

// TestSharedContainerLogsTargetLimiterDoesNotDeadlockBeforeSettingsLoad is the
// regression for the startup self-deadlock: the accessor held
// containerLogsTargetLimiterMu (and settingsMu) while calling loadAppSettings, whose
// tail re-entered the accessor and blocked forever on the same non-reentrant mutex
// (stack: buildRefreshSubsystemForSelection → sharedContainerLogsTargetLimiter →
// loadAppSettings → sharedContainerLogsTargetLimiter). The accessor must return a
// limiter without ever calling back into settings loading — containerLogsTargetLimiterMu
// is a LEAF lock; the settings paths push the configured limit via SetLimit after load.
func TestSharedContainerLogsTargetLimiterDoesNotDeadlockBeforeSettingsLoad(t *testing.T) {
	app := &App{} // appSettings == nil: the pre-settings-load startup state

	done := make(chan *containerlogsstream.GlobalTargetLimiter, 1)
	go func() {
		done <- app.sharedContainerLogsTargetLimiter()
	}()

	select {
	case limiter := <-done:
		if limiter == nil {
			t.Fatal("expected the accessor to create a limiter")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("sharedContainerLogsTargetLimiter deadlocked when app settings were not yet loaded")
	}
}

// TestBuildSubsystemsInSelectionOrderPropagatesFirstError mirrors the serial
// contract: any selection's build error aborts the whole build.
func TestBuildSubsystemsInSelectionOrderPropagatesFirstError(t *testing.T) {
	buildErr := errors.New("subsystem build failed")
	_, err := buildSubsystemsInSelectionOrder(context.Background(), 3, 3,
		func(_ context.Context, index int) (subsystemBuildOutcome, error) {
			if index == 1 {
				return subsystemBuildOutcome{}, buildErr
			}
			return subsystemBuildOutcome{id: fmt.Sprintf("cluster-%d", index)}, nil
		})
	if !errors.Is(err, buildErr) {
		t.Fatalf("expected the builder's error to propagate, got %v", err)
	}
}
