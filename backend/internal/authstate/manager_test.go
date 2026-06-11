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
		OnStateChange: func(s State, reason string) {
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
		OnStateChange: func(s State, reason string) {
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

func TestRecoveryStopsAfterMaxAttempts(t *testing.T) {
	recoveryAttempts := 0
	var mu sync.Mutex
	m := New(Config{
		MaxAttempts:     4,
		BackoffSchedule: []time.Duration{0, 0, 0, 0},
		RecoveryTest: func() error {
			mu.Lock()
			recoveryAttempts++
			mu.Unlock()
			return errors.New("always fails")
		},
	})
	defer m.Shutdown()

	m.ReportFailure("token expired")

	time.Sleep(50 * time.Millisecond)

	state, reason := m.State()
	require.Equal(t, StateInvalid, state)
	require.Contains(t, reason, "maximum attempts")

	mu.Lock()
	require.Equal(t, 4, recoveryAttempts)
	mu.Unlock()
}

func TestTriggerRetryRestartsRecovery(t *testing.T) {
	attempts := 0
	var mu sync.Mutex
	m := New(Config{
		MaxAttempts:     1,
		BackoffSchedule: []time.Duration{0},
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
	time.Sleep(50 * time.Millisecond)

	// Should be invalid after 1 failed attempt
	state, _ := m.State()
	require.Equal(t, StateInvalid, state)

	// Trigger retry
	m.TriggerRetry()
	time.Sleep(50 * time.Millisecond)

	state, _ = m.State()
	require.Equal(t, StateValid, state)

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
		OnStateChange: func(s State, reason string) {
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

func TestReportSuccessWhileValid(t *testing.T) {
	var calls int32
	m := New(Config{
		MaxAttempts: 0,
		OnStateChange: func(s State, reason string) {
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
		OnStateChange: func(s State, reason string) {
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
		ClassifyError: func(err error) ErrorClass {
			mu.Lock()
			defer mu.Unlock()
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
