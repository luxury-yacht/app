package authstate

import (
	"context"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
)

// DefaultMaxAttempts is the default number of recovery attempts.
const DefaultMaxAttempts = config.ClusterAuthRecoveryMaxAttempts

// DefaultBackoffSchedule is the default delay schedule between recovery attempts.
// The first attempt happens immediately, then waits increase.
var DefaultBackoffSchedule = append([]time.Duration(nil), config.ClusterAuthRecoveryBackoffSchedule...)

// RecoveryProgress contains information about the current recovery attempt.
type RecoveryProgress struct {
	// SecondsUntilRetry is the number of seconds until the next retry attempt.
	// This is 0 when a retry is in progress.
	SecondsUntilRetry int
	// ErrorClass is the verdict of the most recent failed probe. It is
	// ErrorClassUnknown until a probe completes, and survives TriggerRetry
	// so consumers see a stable verdict while a new probe is in flight.
	ErrorClass ErrorClass
}

// Config holds the configuration for the auth state Manager.
type Config struct {
	// MaxAttempts is the number of auth-rejected probes before the verdict
	// settles to StateInvalid. Settling does not stop the recovery loop —
	// probing continues at SteadyRetryInterval.
	// Set to 0 to disable automatic recovery entirely.
	// Default: 4
	MaxAttempts int

	// BackoffSchedule defines the delays between recovery attempts during the
	// initial burst. The length should match MaxAttempts. If shorter, the
	// last value is reused.
	// Default: [0, 5s, 10s, 15s]
	BackoffSchedule []time.Duration

	// SteadyRetryInterval is the delay between probes after the verdict has
	// settled to invalid. If 0, config.ClusterAuthSteadyRetryInterval is used.
	SteadyRetryInterval time.Duration

	// OnStateChange is called whenever the auth state changes.
	// The reason is provided for failure states.
	OnStateChange func(state State, reason string)

	// OnRecoveryProgress is called periodically during recovery to report progress.
	// This allows the UI to show countdown timers and attempt counts.
	OnRecoveryProgress func(progress RecoveryProgress)

	// RecoveryTest is a function that tests whether authentication is working.
	// It should return nil if auth is valid, an error otherwise.
	// If nil, recovery will always succeed immediately.
	RecoveryTest func() error

	// ClassifyError maps a RecoveryTest error to an ErrorClass. Connectivity
	// failures do not consume recovery attempts; everything else does.
	// If nil — or if the classifier returns anything other than
	// ErrorClassConnectivity — the failure is treated as auth-class, which
	// preserves the bounded-attempts behavior.
	ClassifyError func(error) ErrorClass

	// ConnectivityRetryInterval is the delay between probes while the cluster
	// is unreachable. If 0, the tail of BackoffSchedule is used.
	ConnectivityRetryInterval time.Duration
}

// Manager manages authentication state and recovery.
// It is safe for concurrent use.
type Manager struct {
	mu sync.RWMutex

	// state is the current authentication state.
	state State

	// failureReason stores the reason for the current failure.
	failureReason string

	// secondsUntilRetry tracks seconds until next retry (0 if retry in progress or not recovering).
	secondsUntilRetry int

	// lastProbeClass is the verdict of the most recent failed recovery probe.
	// Reset on a fresh failure from StateValid; sticky across TriggerRetry so
	// the UI keeps a stable verdict while a re-probe is in flight.
	lastProbeClass ErrorClass

	// config holds the manager configuration.
	config Config

	// ctx is the context for the manager's lifecycle.
	ctx context.Context

	// cancel cancels the manager's context (used in Shutdown).
	cancel context.CancelFunc

	// recoveryCancel cancels the current recovery goroutine, if any.
	recoveryCancel context.CancelFunc

	// wg tracks active goroutines for clean shutdown.
	wg sync.WaitGroup
}

// New creates a new auth state Manager with the given configuration.
// The manager starts in StateValid.
//
// If MaxAttempts is 0, automatic recovery is disabled.
// If BackoffSchedule is nil and MaxAttempts > 0, DefaultBackoffSchedule is used.
func New(cfg Config) *Manager {
	backoff := cfg.BackoffSchedule
	if backoff == nil && cfg.MaxAttempts > 0 {
		backoff = DefaultBackoffSchedule
	}

	ctx, cancel := context.WithCancel(context.Background())

	return &Manager{
		state: StateValid,
		config: Config{
			MaxAttempts:               cfg.MaxAttempts,
			BackoffSchedule:           backoff,
			SteadyRetryInterval:       cfg.SteadyRetryInterval,
			OnStateChange:             cfg.OnStateChange,
			OnRecoveryProgress:        cfg.OnRecoveryProgress,
			RecoveryTest:              cfg.RecoveryTest,
			ClassifyError:             cfg.ClassifyError,
			ConnectivityRetryInterval: cfg.ConnectivityRetryInterval,
		},
		ctx:    ctx,
		cancel: cancel,
	}
}

// State returns the current authentication state and failure reason.
func (m *Manager) State() (State, string) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.state, m.failureReason
}

// IsValid returns true if the current state is StateValid.
func (m *Manager) IsValid() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.state == StateValid
}

// ReportFailure reports an authentication failure.
// If already in StateInvalid or StateRecovering, this call is ignored (idempotent).
// If MaxAttempts > 0, recovery is triggered automatically.
func (m *Manager) ReportFailure(reason string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Idempotent: ignore if not in valid state
	if m.state != StateValid {
		return
	}

	// Fresh failure: no probe has produced a verdict yet.
	m.lastProbeClass = ErrorClassUnknown

	// Transition to recovering or invalid based on config
	if m.config.MaxAttempts > 0 {
		m.setState(StateRecovering, reason)
		m.startRecoveryLocked()
	} else {
		m.setState(StateInvalid, reason)
	}
}

// ReportSuccess reports that authentication is working.
// This resets the state to StateValid from any other state.
func (m *Manager) ReportSuccess() {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Cancel any ongoing recovery
	if m.recoveryCancel != nil {
		m.recoveryCancel()
		m.recoveryCancel = nil
	}

	if m.state != StateValid {
		m.setState(StateValid, "")
	}
}

// TriggerRetry manually triggers an immediate recovery probe by restarting
// the recovery loop (fresh burst, first probe immediate). The state is left
// untouched — only a probe result changes the verdict.
// If in StateValid, this call is ignored.
func (m *Manager) TriggerRetry() {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Ignore if already valid
	if m.state == StateValid {
		return
	}

	if m.config.MaxAttempts > 0 {
		m.secondsUntilRetry = 0
		// startRecoveryLocked cancels any in-flight recovery first.
		m.startRecoveryLocked()
	}
}

// Shutdown stops the manager and cancels any ongoing recovery.
// This should be called when the application is shutting down.
func (m *Manager) Shutdown() {
	m.mu.Lock()
	// Cancel recovery first
	if m.recoveryCancel != nil {
		m.recoveryCancel()
		m.recoveryCancel = nil
	}
	// Cancel the manager's context
	m.cancel()
	m.mu.Unlock()

	// Wait for goroutines to finish
	m.wg.Wait()
}

// setState changes the current state and calls the OnStateChange callback.
// Must be called with m.mu held.
func (m *Manager) setState(newState State, reason string) {
	if m.state == newState && m.failureReason == reason {
		return
	}
	m.state = newState
	m.failureReason = reason
	if m.config.OnStateChange != nil {
		m.config.OnStateChange(newState, reason)
	}
}

// startRecoveryLocked starts the recovery process in a background goroutine.
// Must be called with m.mu held.
func (m *Manager) startRecoveryLocked() {
	// Cancel any existing recovery
	if m.recoveryCancel != nil {
		m.recoveryCancel()
	}

	// Create a new context for this recovery attempt
	recoveryCtx, recoveryCancel := context.WithCancel(m.ctx)
	m.recoveryCancel = recoveryCancel

	m.wg.Add(1)
	go m.runRecovery(recoveryCtx)
}

// runRecovery runs the recovery loop in the background. It never gives up:
// it exits only on a successful probe or cancellation.
//
// Cadence: the initial burst probes at the BackoffSchedule. Auth-class
// failures count toward MaxAttempts; exhausting them settles the verdict to
// StateInvalid — without stopping the loop, which continues at
// steadyRetryDelay so externally fixed credentials are picked up
// automatically. Connectivity-class failures never consume attempts (an
// unreachable cluster says nothing about credential validity) and probe at
// connectivityRetryDelay.
func (m *Manager) runRecovery(ctx context.Context) {
	defer m.wg.Done()

	authFailures := 0
	delay := m.getBackoffDelay(0)
	for {
		// Check if cancelled before starting
		select {
		case <-ctx.Done():
			return
		default:
		}

		if delay > 0 {
			// Emit progress every second during the countdown
			remaining := int(delay.Seconds())
			for remaining > 0 {
				m.emitProgress(remaining)

				select {
				case <-ctx.Done():
					return
				case <-time.After(config.AuthRecoveryProgressInterval):
					remaining--
				}
			}
		}

		// Emit progress with 0 seconds remaining (retry in progress)
		m.emitProgress(0)

		// Check if cancelled before testing
		select {
		case <-ctx.Done():
			return
		default:
		}

		// Run the recovery test
		err := m.testRecovery()
		if err == nil {
			m.mu.Lock()
			// Only update state if we're still the active recovery.
			if ctx.Err() == nil && m.state != StateValid {
				m.setState(StateValid, "")
			}
			m.mu.Unlock()
			return
		}

		class := m.classifyProbeError(err)
		m.mu.Lock()
		m.lastProbeClass = class
		m.mu.Unlock()

		if class == ErrorClassConnectivity {
			// Cluster unreachable: wait without consuming an attempt.
			delay = m.connectivityRetryDelay()
			continue
		}

		authFailures++
		if authFailures >= m.config.MaxAttempts {
			// Credentials confirmed bad: settle the verdict (idempotent —
			// setState dedupes repeats) and keep probing at the steady pace.
			m.mu.Lock()
			if ctx.Err() == nil && m.state == StateRecovering {
				m.setState(StateInvalid, "Credentials were rejected by the cluster. Please re-authenticate.")
			}
			m.mu.Unlock()
			delay = m.steadyRetryDelay()
			continue
		}
		delay = m.getBackoffDelay(authFailures)
	}
}

// classifyProbeError maps a recovery test failure to an ErrorClass.
// Without a classifier — or for any verdict other than connectivity — the
// failure is treated as auth-class so it consumes a recovery attempt.
func (m *Manager) classifyProbeError(err error) ErrorClass {
	if m.config.ClassifyError == nil {
		return ErrorClassAuth
	}
	if class := m.config.ClassifyError(err); class == ErrorClassConnectivity {
		return ErrorClassConnectivity
	}
	return ErrorClassAuth
}

// connectivityRetryDelay returns the wait between probes while the cluster is
// unreachable: the configured interval, falling back to the backoff tail.
func (m *Manager) connectivityRetryDelay() time.Duration {
	if m.config.ConnectivityRetryInterval > 0 {
		return m.config.ConnectivityRetryInterval
	}
	if len(m.config.BackoffSchedule) == 0 {
		return 0
	}
	return m.config.BackoffSchedule[len(m.config.BackoffSchedule)-1]
}

// steadyRetryDelay returns the wait between probes after the verdict has
// settled to invalid. The fallback is always non-zero so a loop can never
// spin hot.
func (m *Manager) steadyRetryDelay() time.Duration {
	if m.config.SteadyRetryInterval > 0 {
		return m.config.SteadyRetryInterval
	}
	return config.ClusterAuthSteadyRetryInterval
}

// emitProgress updates tracked progress and calls the OnRecoveryProgress callback if set.
func (m *Manager) emitProgress(secondsUntilRetry int) {
	m.mu.Lock()
	m.secondsUntilRetry = secondsUntilRetry
	probeClass := m.lastProbeClass
	m.mu.Unlock()

	if m.config.OnRecoveryProgress == nil {
		return
	}
	m.config.OnRecoveryProgress(RecoveryProgress{
		SecondsUntilRetry: secondsUntilRetry,
		ErrorClass:        probeClass,
	})
}

// RecoveryInfo returns the current recovery progress. The loop keeps running
// while the state is invalid (settled verdict, still probing), so progress is
// reported for every non-valid state. Returns zero values when valid.
func (m *Manager) RecoveryInfo() RecoveryProgress {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.state == StateValid {
		return RecoveryProgress{}
	}
	return RecoveryProgress{
		SecondsUntilRetry: m.secondsUntilRetry,
		ErrorClass:        m.lastProbeClass,
	}
}

// getBackoffDelay returns the delay for the given attempt index.
func (m *Manager) getBackoffDelay(attempt int) time.Duration {
	if len(m.config.BackoffSchedule) == 0 {
		return 0
	}
	if attempt >= len(m.config.BackoffSchedule) {
		return m.config.BackoffSchedule[len(m.config.BackoffSchedule)-1]
	}
	return m.config.BackoffSchedule[attempt]
}

// testRecovery runs the recovery test function.
func (m *Manager) testRecovery() error {
	if m.config.RecoveryTest == nil {
		return nil // No test function, assume success
	}
	return m.config.RecoveryTest()
}

// SetRecoveryTest sets the recovery test function.
// This is useful when the test function depends on resources that are
// created after the manager is initialized (e.g., the Kubernetes client).
func (m *Manager) SetRecoveryTest(fn func() error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.config.RecoveryTest = fn
}
