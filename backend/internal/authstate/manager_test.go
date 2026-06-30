package authstate

import (
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestNewManagerStartsValid(t *testing.T) {
	m := New(Config{})
	defer m.Shutdown()
	state, _ := m.State()
	require.Equal(t, StateValid, state)
}

func TestIsValidReturnsTrueWhenValid(t *testing.T) {
	m := New(Config{})
	defer m.Shutdown()
	require.True(t, m.IsValid())
}

func TestReportFailureTransitionsToInvalid(t *testing.T) {
	var stateChanges []State
	var mu sync.Mutex
	m := New(Config{
		OnStateChange: func(s State, _ FailureDiagnostic) {
			mu.Lock()
			stateChanges = append(stateChanges, s)
			mu.Unlock()
		},
		// Disable recovery to test state transition only
		MaxAttempts: 0,
	})
	defer m.Shutdown()

	m.ReportFailure("token expired")

	state, reason := m.State()
	require.Equal(t, StateInvalid, state)
	require.Equal(t, "token expired", reason)
	require.False(t, m.IsValid())

	mu.Lock()
	require.Equal(t, []State{StateInvalid}, stateChanges)
	mu.Unlock()
}

func TestReportFailureIsIdempotent(t *testing.T) {
	var calls int32
	m := New(Config{
		OnStateChange: func(s State, _ FailureDiagnostic) {
			atomic.AddInt32(&calls, 1)
		},
		MaxAttempts: 0,
	})
	defer m.Shutdown()

	m.ReportFailure("first")
	m.ReportFailure("second")
	m.ReportFailure("third")

	// Only first failure should trigger state change
	require.Equal(t, int32(1), atomic.LoadInt32(&calls))
}

func TestReportSuccessResetsToValid(t *testing.T) {
	m := New(Config{MaxAttempts: 0})
	defer m.Shutdown()
	m.ReportFailure("token expired")

	m.ReportSuccess()

	state, reason := m.State()
	require.Equal(t, StateValid, state)
	require.Empty(t, reason)
	require.True(t, m.IsValid())
}

func TestRecoverySucceedsOnFirstAttempt(t *testing.T) {
	recoveryAttempts := 0
	var mu sync.Mutex
	m := New(Config{
		MaxAttempts:     4,
		BackoffSchedule: []time.Duration{0, 0, 0, 0}, // no delays for test
		RecoveryTest: func() error {
			mu.Lock()
			recoveryAttempts++
			mu.Unlock()
			return nil // success
		},
	})
	defer m.Shutdown()

	m.ReportFailure("token expired")

	// Wait for recovery
	time.Sleep(50 * time.Millisecond)

	state, _ := m.State()
	require.Equal(t, StateValid, state)

	mu.Lock()
	require.Equal(t, 1, recoveryAttempts)
	mu.Unlock()
}

func TestRecoveryRetriesOnFailure(t *testing.T) {
	recoveryAttempts := 0
	var mu sync.Mutex
	m := New(Config{
		MaxAttempts:     4,
		BackoffSchedule: []time.Duration{0, 0, 0, 0},
		RecoveryTest: func() error {
			mu.Lock()
			recoveryAttempts++
			count := recoveryAttempts
			mu.Unlock()
			if count < 3 {
				return errors.New("still failing")
			}
			return nil
		},
	})
	defer m.Shutdown()

	m.ReportFailure("token expired")

	time.Sleep(50 * time.Millisecond)

	state, _ := m.State()
	require.Equal(t, StateValid, state)

	mu.Lock()
	require.Equal(t, 3, recoveryAttempts)
	mu.Unlock()
}

func TestAuthFailuresSettleInvalidAndKeepProbing(t *testing.T) {
	// Exhausting the burst settles the verdict to invalid but must NOT stop
	// the loop: probing continues at the steady cadence and a later success
	// (credentials fixed externally) recovers without any outside trigger.
	probes := 0
	var mu sync.Mutex
	var states []State
	m := New(Config{
		MaxAttempts:         2,
		BackoffSchedule:     []time.Duration{0, 0},
		SteadyRetryInterval: time.Millisecond,
		ClassifyError: func(error) ErrorClass {
			return ErrorClassAuth
		},
		OnStateChange: func(s State, _ FailureDiagnostic) {
			mu.Lock()
			states = append(states, s)
			mu.Unlock()
		},
		RecoveryTest: func() error {
			mu.Lock()
			probes++
			count := probes
			mu.Unlock()
			if count < 5 {
				return errors.New("401 Unauthorized")
			}
			return nil
		},
	})
	defer m.Shutdown()

	m.ReportFailure("token expired")

	require.Eventually(t, func() bool {
		state, _ := m.State()
		return state == StateValid
	}, time.Second, 5*time.Millisecond,
		"the loop must keep probing past the settled invalid verdict")

	mu.Lock()
	require.Equal(t, 5, probes)
	require.Equal(t, []State{StateRecovering, StateInvalid, StateValid}, states,
		"the invalid verdict must settle exactly once, then recover")
	mu.Unlock()
}

func TestTriggerRetryProbesImmediately(t *testing.T) {
	attempts := 0
	var mu sync.Mutex
	m := New(Config{
		MaxAttempts:     1,
		BackoffSchedule: []time.Duration{0},
		// Park the steady cadence out of the test window so only the manual
		// retry can produce the second probe.
		SteadyRetryInterval: time.Hour,
		ClassifyError: func(error) ErrorClass {
			return ErrorClassAuth
		},
		RecoveryTest: func() error {
			mu.Lock()
			attempts++
			count := attempts
			mu.Unlock()
			if count < 2 {
				return errors.New("fail")
			}
			return nil
		},
	})
	defer m.Shutdown()

	m.ReportFailure("token expired")
	require.Eventually(t, func() bool {
		state, _ := m.State()
		return state == StateInvalid
	}, time.Second, 5*time.Millisecond)

	// Trigger retry: restarts the loop with an immediate probe.
	m.TriggerRetry()
	require.Eventually(t, func() bool {
		state, _ := m.State()
		return state == StateValid
	}, time.Second, 5*time.Millisecond)

	mu.Lock()
	require.Equal(t, 2, attempts)
	mu.Unlock()
}

func TestShutdownCancelsRecovery(t *testing.T) {
	m := New(Config{
		MaxAttempts:     4,
		BackoffSchedule: []time.Duration{100 * time.Millisecond, 100 * time.Millisecond, 100 * time.Millisecond, 100 * time.Millisecond},
		RecoveryTest: func() error {
			return errors.New("fail")
		},
	})

	m.ReportFailure("token expired")
	time.Sleep(10 * time.Millisecond) // Let recovery start

	// Shutdown should complete quickly
	done := make(chan struct{})
	go func() {
		m.Shutdown()
		close(done)
	}()

	select {
	case <-done:
		// Shutdown completed successfully
	case <-time.After(500 * time.Millisecond):
		t.Fatal("Shutdown did not complete in time")
	}
}

func TestStateReturnsReason(t *testing.T) {
	m := New(Config{MaxAttempts: 0})
	defer m.Shutdown()
	m.ReportFailure("SSO token expired")

	state, reason := m.State()
	require.Equal(t, StateInvalid, state)
	require.Equal(t, "SSO token expired", reason)
}

func TestOnStateChangeCallback(t *testing.T) {
	var stateChanges []State
	var mu sync.Mutex
	m := New(Config{
		MaxAttempts:     1,
		BackoffSchedule: []time.Duration{0},
		OnStateChange: func(s State, _ FailureDiagnostic) {
			mu.Lock()
			stateChanges = append(stateChanges, s)
			mu.Unlock()
		},
		RecoveryTest: func() error {
			return nil // success
		},
	})
	defer m.Shutdown()

	m.ReportFailure("token expired")
	time.Sleep(50 * time.Millisecond)

	mu.Lock()
	// Should have: StateRecovering -> StateValid
	require.Len(t, stateChanges, 2)
	require.Equal(t, StateRecovering, stateChanges[0])
	require.Equal(t, StateValid, stateChanges[1])
	mu.Unlock()
}

func TestReportFailureDiagnosticStoresTypedFields(t *testing.T) {
	m := New(Config{MaxAttempts: 0})
	defer m.Shutdown()

	diag := FailureDiagnostic{
		Reason:      "getting credentials: exec: executable gke-gcloud-auth-plugin not found",
		Class:       "auth",
		Kind:        "missing-helper",
		Summary:     "The kubeconfig's credential helper could not be found.",
		ExecCommand: "gke-gcloud-auth-plugin",
	}
	m.ReportFailureDiagnostic(diag)

	state, reason := m.State()
	require.Equal(t, StateInvalid, state)
	require.Equal(t, diag.Reason, reason, "State() reason comes from the diagnostic")
	require.Equal(t, diag, m.FailureDiagnostic())

	// Recovery clears the stored diagnostic.
	m.ReportSuccess()
	require.Equal(t, FailureDiagnostic{}, m.FailureDiagnostic())
}

func TestOnStateChangeReceivesDiagnostic(t *testing.T) {
	var got FailureDiagnostic
	var mu sync.Mutex
	m := New(Config{
		MaxAttempts: 0,
		OnStateChange: func(_ State, diag FailureDiagnostic) {
			mu.Lock()
			got = diag
			mu.Unlock()
		},
	})
	defer m.Shutdown()

	want := FailureDiagnostic{Reason: "boom", Class: "auth", ExecCommand: "aws"}
	m.ReportFailureDiagnostic(want)

	mu.Lock()
	defer mu.Unlock()
	require.Equal(t, want, got, "the diagnostic flows through OnStateChange unchanged")
}

func TestReportSuccessWhileValid(t *testing.T) {
	var calls int32
	m := New(Config{
		MaxAttempts: 0,
		OnStateChange: func(s State, _ FailureDiagnostic) {
			atomic.AddInt32(&calls, 1)
		},
	})
	defer m.Shutdown()

	// Manager starts valid, ReportSuccess should not trigger state change
	m.ReportSuccess()

	require.Equal(t, int32(0), atomic.LoadInt32(&calls))
}

func TestTriggerRetryWhileValid(t *testing.T) {
	var calls int32
	m := New(Config{
		MaxAttempts: 1,
		OnStateChange: func(s State, _ FailureDiagnostic) {
			atomic.AddInt32(&calls, 1)
		},
	})
	defer m.Shutdown()

	// TriggerRetry should be ignored when valid
	m.TriggerRetry()

	require.Equal(t, int32(0), atomic.LoadInt32(&calls))
}

func TestConnectivityErrorsDoNotConsumeRecoveryAttempts(t *testing.T) {
	// A cluster that is unreachable (e.g. mid-upgrade) must not exhaust the
	// recovery budget: connectivity-class probe failures keep the manager in
	// StateRecovering and probing until the cluster answers.
	probes := 0
	var mu sync.Mutex
	m := New(Config{
		MaxAttempts:               2,
		BackoffSchedule:           []time.Duration{0, 0},
		ConnectivityRetryInterval: time.Millisecond,
		ClassifyError: func(err error) ErrorClass {
			return ErrorClassConnectivity
		},
		RecoveryTest: func() error {
			mu.Lock()
			probes++
			count := probes
			mu.Unlock()
			if count < 5 {
				return errors.New("connection refused")
			}
			return nil
		},
	})
	defer m.Shutdown()

	m.ReportFailure("401 Unauthorized")

	require.Eventually(t, func() bool {
		state, _ := m.State()
		return state == StateValid
	}, time.Second, 5*time.Millisecond)

	mu.Lock()
	require.Equal(t, 5, probes, "recovery must keep probing past MaxAttempts while unreachable")
	mu.Unlock()
}

func TestAuthErrorsConsumeRecoveryAttemptsAcrossConnectivityGaps(t *testing.T) {
	// Mixed failures: connectivity probes wait without consuming attempts,
	// auth-class probes consume them. Two auth verdicts with MaxAttempts=2
	// must end in StateInvalid even with connectivity gaps in between.
	var mu sync.Mutex
	results := []ErrorClass{
		ErrorClassConnectivity,
		ErrorClassAuth,
		ErrorClassConnectivity,
		ErrorClassAuth,
	}
	probes := 0
	m := New(Config{
		MaxAttempts:               2,
		BackoffSchedule:           []time.Duration{0, 0},
		ConnectivityRetryInterval: time.Millisecond,
		// Park the post-settle cadence outside the test window: this test
		// only exercises the burst's attempt accounting.
		SteadyRetryInterval: time.Hour,
		ClassifyError: func(err error) ErrorClass {
			mu.Lock()
			defer mu.Unlock()
			if probes > len(results) {
				return ErrorClassAuth
			}
			return results[probes-1]
		},
		RecoveryTest: func() error {
			mu.Lock()
			probes++
			mu.Unlock()
			return errors.New("probe failed")
		},
	})
	defer m.Shutdown()

	m.ReportFailure("401 Unauthorized")

	require.Eventually(t, func() bool {
		state, _ := m.State()
		return state == StateInvalid
	}, time.Second, 5*time.Millisecond)

	mu.Lock()
	require.Equal(t, 4, probes)
	mu.Unlock()
}

func TestRecoveryInfoReportsLastErrorClass(t *testing.T) {
	probeDone := make(chan struct{}, 8)
	gate := make(chan struct{})
	m := New(Config{
		MaxAttempts:               4,
		BackoffSchedule:           []time.Duration{0, 0, 0, 0},
		ConnectivityRetryInterval: 250 * time.Millisecond,
		ClassifyError: func(err error) ErrorClass {
			return ErrorClassConnectivity
		},
		RecoveryTest: func() error {
			select {
			case probeDone <- struct{}{}:
			default:
			}
			<-gate
			return errors.New("connection refused")
		},
	})
	defer m.Shutdown()

	m.ReportFailure("401 Unauthorized")

	// Before any probe result, the verdict is unknown.
	<-probeDone
	require.Equal(t, ErrorClassUnknown, m.RecoveryInfo().ErrorClass)

	// Let the probes fail; the connectivity verdict must be exposed while
	// the manager waits to probe again. close (not a single send) so later
	// probes never block — a probe stuck in RecoveryTest would deadlock
	// Shutdown, which waits for the recovery goroutine.
	close(gate)
	require.Eventually(t, func() bool {
		return m.RecoveryInfo().ErrorClass == ErrorClassConnectivity
	}, time.Second, 5*time.Millisecond)
}

func TestErrorClassIsStickyAcrossTriggerRetry(t *testing.T) {
	// After auth-class failures exhaust recovery, a manual/automatic retry
	// must keep reporting the auth verdict until a new probe result
	// contradicts it — the UI uses this to keep the failure surface stable.
	gate := make(chan struct{})
	probeStarted := make(chan struct{}, 8)
	var blockProbes atomic.Bool
	m := New(Config{
		MaxAttempts:     1,
		BackoffSchedule: []time.Duration{0},
		ClassifyError: func(err error) ErrorClass {
			return ErrorClassAuth
		},
		RecoveryTest: func() error {
			if blockProbes.Load() {
				select {
				case probeStarted <- struct{}{}:
				default:
				}
				<-gate
			}
			return errors.New("401 Unauthorized")
		},
	})
	defer m.Shutdown()

	m.ReportFailure("401 Unauthorized")
	require.Eventually(t, func() bool {
		state, _ := m.State()
		return state == StateInvalid
	}, time.Second, 5*time.Millisecond)

	blockProbes.Store(true)
	m.TriggerRetry()

	// While the retry probe is in flight the previous auth verdict holds.
	<-probeStarted
	require.Equal(t, ErrorClassAuth, m.RecoveryInfo().ErrorClass)
	close(gate)
}

func TestTriggerRetryWhileRecovering(t *testing.T) {
	recoveryStarted := make(chan struct{}, 1)
	recoveryAllowed := make(chan struct{})
	m := New(Config{
		MaxAttempts:     1,
		BackoffSchedule: []time.Duration{0},
		RecoveryTest: func() error {
			select {
			case recoveryStarted <- struct{}{}:
			default:
			}
			<-recoveryAllowed
			return nil
		},
	})
	defer m.Shutdown()

	m.ReportFailure("token expired")

	// Wait for recovery to start
	<-recoveryStarted

	// State should be recovering
	state, _ := m.State()
	require.Equal(t, StateRecovering, state)

	// TriggerRetry should be ignored while recovering
	m.TriggerRetry()

	// Still recovering
	state, _ = m.State()
	require.Equal(t, StateRecovering, state)

	// Let recovery complete
	close(recoveryAllowed)
	time.Sleep(50 * time.Millisecond)

	state, _ = m.State()
	require.Equal(t, StateValid, state)
}

// TestRecoveryTestRaceFreeUnderConcurrentSet guards the synchronization between
// the recovery goroutine's probe (testRecovery) and SetRecoveryTest. The
// recovery loop reads config.RecoveryTest while the app may swap it in once the
// Kubernetes client is ready; both must be safe to call concurrently. This test
// is meaningful under the race detector (mage test:race / go test -race): before
// the fix the lock-free read in testRecovery races the locked write in
// SetRecoveryTest.
func TestRecoveryTestRaceFreeUnderConcurrentSet(t *testing.T) {
	m := New(Config{RecoveryTest: func() error { return nil }})
	defer m.Shutdown()

	var wg sync.WaitGroup
	wg.Add(2)

	// Reader: mirrors the recovery goroutine repeatedly probing.
	go func() {
		defer wg.Done()
		for i := 0; i < 10000; i++ {
			_ = m.testRecovery()
		}
	}()

	// Writer: app installing the real recovery test after init.
	go func() {
		defer wg.Done()
		for i := 0; i < 10000; i++ {
			m.SetRecoveryTest(func() error { return nil })
		}
	}()

	wg.Wait()
}
