package authstate

import (
	"context"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/credentialerrors"
)

// FailureDiagnostic carries the reason for an auth failure together with optional
// typed fields a UI can use to explain it without echoing raw provider stderr.
type FailureDiagnostic struct {
	// Reason is the raw/human reason. Kept for existing UI copy and logging.
	Reason string
	// Class is the credentialerrors verdict: "auth", "connectivity", or "".
	Class string
	// Kind is the finer credentialerrors classification (e.g. "missing-helper").
	Kind string
	// Summary is a sanitized, provider-neutral one-line description.
	Summary string
	// ExecCommand is the kubeconfig exec credential command, when known.
	ExecCommand string
}

// NewFailureDiagnostic builds a FailureDiagnostic from a classified credential
// error. The typed fields come from the diagnostic.
func NewFailureDiagnostic(err error, d credentialerrors.Diagnostic) FailureDiagnostic {
	reason := ""
	if err != nil {
		reason = err.Error()
	}
	return FailureDiagnostic{
		Reason:      reason,
		Class:       string(d.Class),
		Kind:        string(d.Kind),
		Summary:     d.Summary,
		ExecCommand: d.ExecCommand,
	}
}

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

	// OnStateChange is called whenever the auth state changes. The diagnostic
	// carries the reason plus typed credential fields for failure states; it is
	// the zero value for the transition back to StateValid.
	OnStateChange func(state State, diag FailureDiagnostic)

	// OnRecoveryProgress is called periodically during recovery to report progress.
	// This allows the UI to show countdown timers and attempt counts.
	OnRecoveryProgress func(progress RecoveryProgress)

	// OnSnapshotChange marks a committed change to state exposed by State,
	// FailureDiagnostic, or RecoveryInfo. It runs while the manager lock is held
	// and therefore must not call back into Manager.
	OnSnapshotChange func()

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

	// failureDiagnostic stores the diagnostic for the current failure. Its
	// Reason field is what State() returns; the zero value means no failure.
	failureDiagnostic FailureDiagnostic

	// secondsUntilRetry tracks seconds until next retry (0 if retry in progress or not recovering).
	secondsUntilRetry int

	// lastProbeClass is the verdict of the most recent failed recovery probe.
	// Reset on a fresh failure from StateValid; sticky across TriggerRetry so
	// the UI keeps a stable verdict while a re-probe is in flight.
	lastProbeClass ErrorClass

	// config holds the manager configuration.
	config Config

	// stopped prevents recovery from restarting after Shutdown.
	stopped bool

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

	return &Manager{
		state: StateValid,
		config: Config{
			MaxAttempts:               cfg.MaxAttempts,
			BackoffSchedule:           backoff,
			SteadyRetryInterval:       cfg.SteadyRetryInterval,
			OnStateChange:             cfg.OnStateChange,
			OnRecoveryProgress:        cfg.OnRecoveryProgress,
			OnSnapshotChange:          cfg.OnSnapshotChange,
			RecoveryTest:              cfg.RecoveryTest,
			ClassifyError:             cfg.ClassifyError,
			ConnectivityRetryInterval: cfg.ConnectivityRetryInterval,
		},
	}
}

// State returns the current authentication state and failure reason.
func (m *Manager) State() (State, string) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.state, m.failureDiagnostic.Reason
}

// FailureDiagnostic returns the diagnostic for the current failure (zero value
// when valid). Safe for concurrent use.
func (m *Manager) FailureDiagnostic() FailureDiagnostic {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.failureDiagnostic
}

// IsValid returns true if the current state is StateValid.
func (m *Manager) IsValid() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.state == StateValid
}

// ReportFailure reports an authentication failure described only by a reason
// string. Callers with a classified credential error should use
// ReportFailureDiagnostic to carry the typed fields.
func (m *Manager) ReportFailure(reason string) {
	m.ReportFailureDiagnostic(FailureDiagnostic{Reason: reason})
}

// ReportFailureDiagnostic reports an authentication failure with a typed
// diagnostic. If already in StateInvalid or StateRecovering, this call is ignored
// (idempotent). If MaxAttempts > 0, recovery is triggered automatically.
func (m *Manager) ReportFailureDiagnostic(diag FailureDiagnostic) {
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
		m.setState(StateRecovering, diag)
		m.startRecoveryLocked()
	} else {
		m.setState(StateInvalid, diag)
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
		m.setState(StateValid, FailureDiagnostic{})
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
		if m.secondsUntilRetry != 0 {
			m.secondsUntilRetry = 0
			m.markSnapshotChangeLocked()
		}
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
	m.stopped = true
	m.mu.Unlock()

	// Wait for goroutines to finish
	m.wg.Wait()
}

// setState changes the current state and calls the OnStateChange callback.
// Must be called with m.mu held.
func (m *Manager) setState(newState State, diag FailureDiagnostic) {
	if m.state == newState && equalFailureDiagnostic(m.failureDiagnostic, diag) {
		return
	}
	m.state = newState
	m.failureDiagnostic = diag
	m.markSnapshotChangeLocked()
	if m.config.OnStateChange != nil {
		m.config.OnStateChange(newState, diag)
	}
}

func equalFailureDiagnostic(left, right FailureDiagnostic) bool {
	return left.Reason == right.Reason &&
		left.Class == right.Class &&
		left.Kind == right.Kind &&
		left.Summary == right.Summary &&
		left.ExecCommand == right.ExecCommand
}

func (m *Manager) markSnapshotChangeLocked() {
	if m.config.OnSnapshotChange != nil {
		m.config.OnSnapshotChange()
	}
}

// startRecoveryLocked starts the recovery process in a background goroutine.
// Must be called with m.mu held.
func (m *Manager) startRecoveryLocked() {
	if m.stopped {
		return
	}
	// Cancel any existing recovery
	if m.recoveryCancel != nil {
		m.recoveryCancel()
	}

	// Create a new context for this recovery attempt
	recoveryCtx, recoveryCancel := context.WithCancel(context.Background())
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
		if !m.waitForRecoveryDelay(ctx, delay) {
			return
		}
		class, finished := m.runRecoveryProbe(ctx)
		if finished {
			return
		}
		m.recordRecoveryProbeClass(class)
		if class == ErrorClassConnectivity {
			delay = m.connectivityRetryDelay()
			continue
		}
		authFailures++
		if authFailures >= m.config.MaxAttempts {
			m.settleInvalidCredentials(ctx)
			delay = m.steadyRetryDelay()
			continue
		}
		delay = m.getBackoffDelay(authFailures)
	}
}

func (m *Manager) waitForRecoveryDelay(ctx context.Context, delay time.Duration) bool {
	if ctx.Err() != nil {
		return false
	}
	for remaining := int(delay.Seconds()); remaining > 0; remaining-- {
		m.emitProgress(remaining)
		select {
		case <-ctx.Done():
			return false
		case <-time.After(config.AuthRecoveryProgressInterval):
		}
	}
	return true
}

func (m *Manager) runRecoveryProbe(ctx context.Context) (ErrorClass, bool) {
	m.emitProgress(0)
	if ctx.Err() != nil {
		return ErrorClassUnknown, true
	}
	err := m.testRecovery()
	if err != nil {
		return m.classifyProbeError(err), false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if ctx.Err() == nil && m.state != StateValid {
		m.setState(StateValid, FailureDiagnostic{})
	}
	return ErrorClassUnknown, true
}

func (m *Manager) recordRecoveryProbeClass(class ErrorClass) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.lastProbeClass != class {
		m.lastProbeClass = class
		m.markSnapshotChangeLocked()
	}
}

func (m *Manager) settleInvalidCredentials(ctx context.Context) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if ctx.Err() != nil || m.state != StateRecovering {
		return
	}
	settled := m.failureDiagnostic
	settled.Reason = "Credentials were rejected by the cluster. Please re-authenticate."
	m.setState(StateInvalid, settled)
}

// classifyProbeError maps a recovery test failure to an ErrorClass.
// Without a classifier — or for any verdict other than connectivity — the
// failure is treated as auth-class so it consumes a recovery attempt.
func (m *Manager) classifyProbeError(err error) ErrorClass {
	if m.config.ClassifyError == nil {
		return ErrorClassAuth
	}
	if m.config.ClassifyError(err) == ErrorClassConnectivity {
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
	if m.secondsUntilRetry != secondsUntilRetry {
		m.secondsUntilRetry = secondsUntilRetry
		m.markSnapshotChangeLocked()
	}
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

// testRecovery runs the recovery test function. The function pointer is
// snapshotted under the lock because SetRecoveryTest can swap it concurrently,
// then invoked outside the lock: the probe does network I/O and may re-enter the
// manager via the auth-aware transport (ReportSuccess/ReportFailure take m.mu),
// so holding the lock across the call would self-deadlock.
func (m *Manager) testRecovery() error {
	m.mu.RLock()
	fn := m.config.RecoveryTest
	m.mu.RUnlock()
	if fn == nil {
		return nil // No test function, assume success
	}
	return fn()
}

// SetRecoveryTest sets the recovery test function.
// This is useful when the test function depends on resources that are
// created after the manager is initialized (e.g., the Kubernetes client).
func (m *Manager) SetRecoveryTest(fn func() error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.config.RecoveryTest = fn
}
