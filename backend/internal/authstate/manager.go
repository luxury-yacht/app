package authstate

import (
	"context"
	"sync"
	"time"
)

// DefaultMaxAttempts is the default number of recovery attempts.
const DefaultMaxAttempts = 4

// DefaultBackoffSchedule is the default delay schedule between recovery attempts.
// The first attempt happens immediately, then waits increase.
var DefaultBackoffSchedule = []time.Duration{0, 5 * time.Second, 10 * time.Second, 15 * time.Second}

// RecoveryProgress contains information about the current recovery attempt.
type RecoveryProgress struct {
	// CurrentAttempt is the current attempt number (1-based).
	CurrentAttempt int
	// MaxAttempts is the total number of attempts that will be made.
	MaxAttempts int
	// SecondsUntilRetry is the number of seconds until the next retry attempt.
	// This is 0 when a retry is in progress.
	SecondsUntilRetry int
}

// Config holds the configuration for the auth state Manager.
type Config struct {
	// MaxAttempts is the number of recovery attempts before giving up.
	// Set to 0 to disable automatic recovery.
	// Default: 4
	MaxAttempts int

	// BackoffSchedule defines the delays between recovery attempts.
	// The length should match MaxAttempts. If shorter, the last value is reused.
	// Default: [0, 5s, 10s, 15s]
	BackoffSchedule []time.Duration

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
}

// Manager manages authentication state and recovery.
// It is safe for concurrent use.
type Manager struct {
	mu sync.RWMutex

	// state is the current authentication state.
	state State

	// failureReason stores the reason for the current failure.
	failureReason string

	// currentAttempt tracks the current recovery attempt (1-based, 0 if not recovering).
	currentAttempt int

	// secondsUntilRetry tracks seconds until next retry (0 if retry in progress or not recovering).
	secondsUntilRetry int

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
		state:  StateValid,
		config: Config{
			MaxAttempts:        cfg.MaxAttempts,
			BackoffSchedule:    backoff,
			OnStateChange:      cfg.OnStateChange,
			OnRecoveryProgress: cfg.OnRecoveryProgress,
			RecoveryTest:       cfg.RecoveryTest,
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

// TriggerRetry manually triggers a recovery attempt.
// If in StateInvalid, starts a new recovery cycle.
// If in StateRecovering, cancels the current recovery and starts fresh immediately.
// If in StateValid, this call is ignored.
func (m *Manager) TriggerRetry() {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Ignore if already valid
	if m.state == StateValid {
		return
	}

	// Cancel any ongoing recovery before starting fresh
	if m.recoveryCancel != nil {
		m.recoveryCancel()
		m.recoveryCancel = nil
	}

	reason := m.failureReason
	if m.config.MaxAttempts > 0 {
		// Reset attempt tracking for fresh start
		m.currentAttempt = 0
		m.secondsUntilRetry = 0
		m.setState(StateRecovering, reason)
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

// runRecovery runs the recovery loop in the background.
func (m *Manager) runRecovery(ctx context.Context) {
	defer m.wg.Done()

	for attempt := 0; attempt < m.config.MaxAttempts; attempt++ {
		// Check if cancelled before starting
		select {
		case <-ctx.Done():
			return
		default:
		}

		// Get backoff delay for this attempt
		delay := m.getBackoffDelay(attempt)
		if delay > 0 {
			// Emit progress every second during the countdown
			remaining := int(delay.Seconds())
			for remaining > 0 {
				m.emitProgress(attempt+1, remaining)

				select {
				case <-ctx.Done():
					return
				case <-time.After(time.Second):
					remaining--
				}
			}
		}

		// Emit progress with 0 seconds remaining (retry in progress)
		m.emitProgress(attempt+1, 0)

		// Check if cancelled before testing
		select {
		case <-ctx.Done():
			return
		default:
		}

		// Run the recovery test
		if err := m.testRecovery(); err == nil {
			m.mu.Lock()
			// Only update state if we're still the active recovery and in recovering state
			if ctx.Err() == nil && m.state == StateRecovering {
				m.setState(StateValid, "")
			}
			m.mu.Unlock()
			return
		}
	}

	// All attempts exhausted - transition to invalid
	m.mu.Lock()
	// Only update state if we're still the active recovery and in recovering state
	if ctx.Err() == nil && m.state == StateRecovering {
		m.setState(StateInvalid, "Recovery failed after maximum attempts. Please re-authenticate.")
	}
	m.mu.Unlock()
}

// emitProgress updates tracked progress and calls the OnRecoveryProgress callback if set.
func (m *Manager) emitProgress(currentAttempt, secondsUntilRetry int) {
	m.mu.Lock()
	m.currentAttempt = currentAttempt
	m.secondsUntilRetry = secondsUntilRetry
	m.mu.Unlock()

	if m.config.OnRecoveryProgress == nil {
		return
	}
	m.config.OnRecoveryProgress(RecoveryProgress{
		CurrentAttempt:    currentAttempt,
		MaxAttempts:       m.config.MaxAttempts,
		SecondsUntilRetry: secondsUntilRetry,
	})
}

// RecoveryInfo returns the current recovery progress.
// Returns zero values if not in recovery state.
func (m *Manager) RecoveryInfo() RecoveryProgress {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.state != StateRecovering {
		return RecoveryProgress{}
	}
	return RecoveryProgress{
		CurrentAttempt:    m.currentAttempt,
		MaxAttempts:       m.config.MaxAttempts,
		SecondsUntilRetry: m.secondsUntilRetry,
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
