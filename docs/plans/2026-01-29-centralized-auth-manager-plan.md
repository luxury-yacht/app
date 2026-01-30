# Centralized Auth State Manager Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Centralize authentication failure detection and recovery to eliminate error spam when tokens expire.

**Architecture:** New `authstate` package with a state machine (`Manager`) and HTTP transport wrapper. The manager coordinates all auth failure detection (exec plugin stderr, HTTP 401s) and recovery attempts, blocking API calls while auth is invalid.

**Tech Stack:** Go (backend), React/TypeScript (frontend), Wails runtime events, testify for assertions.

---

## Task 1: Create Auth State Types and Errors

**Files:**
- Create: `backend/internal/authstate/types.go`
- Create: `backend/internal/authstate/errors.go`
- Test: `backend/internal/authstate/errors_test.go`

**Step 1: Create the authstate directory**

```bash
mkdir -p backend/internal/authstate
```

**Step 2: Write the failing test for AuthInvalidError**

```go
// backend/internal/authstate/errors_test.go
package authstate

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestAuthInvalidErrorMessage(t *testing.T) {
	err := &AuthInvalidError{Reason: "token expired"}
	require.Equal(t, "auth invalid: token expired", err.Error())
}

func TestAuthInvalidErrorIs(t *testing.T) {
	err := &AuthInvalidError{Reason: "401 Unauthorized"}
	wrapped := errors.New("wrapped")

	require.True(t, errors.Is(err, err))
	require.False(t, errors.Is(err, wrapped))
}
```

**Step 3: Run test to verify it fails**

```bash
go test ./backend/internal/authstate/... -v -run TestAuthInvalidError
```

Expected: FAIL - package does not exist

**Step 4: Write types.go**

```go
// backend/internal/authstate/types.go
package authstate

// State represents the current authentication state.
type State int

const (
	// StateValid indicates authentication is working.
	StateValid State = iota
	// StateInvalid indicates authentication has failed and requires user action.
	StateInvalid
	// StateRecovering indicates automatic recovery is in progress.
	StateRecovering
)

// String returns a human-readable state name.
func (s State) String() string {
	switch s {
	case StateValid:
		return "valid"
	case StateInvalid:
		return "invalid"
	case StateRecovering:
		return "recovering"
	default:
		return "unknown"
	}
}
```

**Step 5: Write errors.go**

```go
// backend/internal/authstate/errors.go
package authstate

import "fmt"

// AuthInvalidError is returned when an API call is blocked due to invalid auth state.
type AuthInvalidError struct {
	Reason string
	State  State
}

// Error implements the error interface.
func (e *AuthInvalidError) Error() string {
	return fmt.Sprintf("auth invalid: %s", e.Reason)
}

// Is supports errors.Is comparison.
func (e *AuthInvalidError) Is(target error) bool {
	_, ok := target.(*AuthInvalidError)
	return ok
}
```

**Step 6: Run test to verify it passes**

```bash
go test ./backend/internal/authstate/... -v -run TestAuthInvalidError
```

Expected: PASS

---

## Task 2: Create Auth State Manager Core

**Files:**
- Create: `backend/internal/authstate/manager.go`
- Test: `backend/internal/authstate/manager_test.go`

**Step 1: Write failing tests for Manager state transitions**

```go
// backend/internal/authstate/manager_test.go
package authstate

import (
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestNewManagerStartsValid(t *testing.T) {
	m := New(Config{})
	state, _ := m.State()
	require.Equal(t, StateValid, state)
}

func TestIsValidReturnsTrueWhenValid(t *testing.T) {
	m := New(Config{})
	require.True(t, m.IsValid())
}

func TestReportFailureTransitionsToRecovering(t *testing.T) {
	var stateChanges []State
	m := New(Config{
		OnStateChange: func(s State, reason string) {
			stateChanges = append(stateChanges, s)
		},
		// Disable recovery to test state transition only
		MaxAttempts: 0,
	})

	m.ReportFailure("token expired")

	state, reason := m.State()
	require.Equal(t, StateInvalid, state)
	require.Equal(t, "token expired", reason)
	require.False(t, m.IsValid())
}

func TestReportFailureIsIdempotent(t *testing.T) {
	var calls int32
	m := New(Config{
		OnStateChange: func(s State, reason string) {
			atomic.AddInt32(&calls, 1)
		},
		MaxAttempts: 0,
	})

	m.ReportFailure("first")
	m.ReportFailure("second")
	m.ReportFailure("third")

	// Only first failure should trigger state change
	require.Equal(t, int32(1), atomic.LoadInt32(&calls))
}

func TestReportSuccessResetsToValid(t *testing.T) {
	m := New(Config{MaxAttempts: 0})
	m.ReportFailure("token expired")

	m.ReportSuccess()

	state, reason := m.State()
	require.Equal(t, StateValid, state)
	require.Empty(t, reason)
	require.True(t, m.IsValid())
}
```

**Step 2: Run test to verify it fails**

```bash
go test ./backend/internal/authstate/... -v -run TestNewManager
```

Expected: FAIL - New not defined

**Step 3: Write minimal Manager implementation**

```go
// backend/internal/authstate/manager.go
package authstate

import (
	"context"
	"sync"
	"time"
)

// Config configures the auth state manager.
type Config struct {
	// MaxAttempts is the number of recovery attempts before giving up (default: 4).
	MaxAttempts int
	// BackoffSchedule defines delays between recovery attempts (default: [0, 5s, 10s, 15s]).
	BackoffSchedule []time.Duration
	// OnStateChange is called when auth state changes.
	OnStateChange func(State, string)
	// RecoveryTest is called to test if auth is working during recovery.
	RecoveryTest func() error
}

// Manager coordinates authentication state and recovery.
type Manager struct {
	mu            sync.RWMutex
	state         State
	failureReason string

	maxAttempts     int
	backoffSchedule []time.Duration
	onStateChange   func(State, string)
	recoveryTest    func() error

	recoveryCtx    context.Context
	recoveryCancel context.CancelFunc
}

// New creates a new auth state manager.
func New(cfg Config) *Manager {
	maxAttempts := cfg.MaxAttempts
	if maxAttempts == 0 && cfg.BackoffSchedule == nil {
		maxAttempts = 4
	}

	backoff := cfg.BackoffSchedule
	if backoff == nil && maxAttempts > 0 {
		backoff = []time.Duration{0, 5 * time.Second, 10 * time.Second, 15 * time.Second}
	}

	return &Manager{
		state:           StateValid,
		maxAttempts:     maxAttempts,
		backoffSchedule: backoff,
		onStateChange:   cfg.OnStateChange,
		recoveryTest:    cfg.RecoveryTest,
	}
}

// State returns the current auth state and failure reason.
func (m *Manager) State() (State, string) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.state, m.failureReason
}

// IsValid returns true if auth is currently valid.
func (m *Manager) IsValid() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.state == StateValid
}

// ReportFailure records an authentication failure and starts recovery.
// Subsequent calls while already invalid/recovering are ignored.
func (m *Manager) ReportFailure(reason string) {
	m.mu.Lock()
	if m.state != StateValid {
		m.mu.Unlock()
		return
	}
	m.state = StateInvalid
	m.failureReason = reason
	m.mu.Unlock()

	if m.onStateChange != nil {
		m.onStateChange(StateInvalid, reason)
	}

	if m.maxAttempts > 0 {
		m.startRecovery()
	}
}

// ReportSuccess resets auth state to valid.
func (m *Manager) ReportSuccess() {
	m.mu.Lock()
	wasInvalid := m.state != StateValid
	m.state = StateValid
	m.failureReason = ""
	if m.recoveryCancel != nil {
		m.recoveryCancel()
		m.recoveryCancel = nil
	}
	m.mu.Unlock()

	if wasInvalid && m.onStateChange != nil {
		m.onStateChange(StateValid, "")
	}
}

func (m *Manager) startRecovery() {
	m.mu.Lock()
	if m.recoveryCancel != nil {
		m.recoveryCancel()
	}
	ctx, cancel := context.WithCancel(context.Background())
	m.recoveryCtx = ctx
	m.recoveryCancel = cancel
	m.state = StateRecovering
	m.mu.Unlock()

	if m.onStateChange != nil {
		m.onStateChange(StateRecovering, m.failureReason)
	}

	go m.runRecovery(ctx)
}

func (m *Manager) runRecovery(ctx context.Context) {
	for attempt := 0; attempt < m.maxAttempts; attempt++ {
		if attempt < len(m.backoffSchedule) {
			delay := m.backoffSchedule[attempt]
			if delay > 0 {
				select {
				case <-ctx.Done():
					return
				case <-time.After(delay):
				}
			}
		}

		select {
		case <-ctx.Done():
			return
		default:
		}

		if m.recoveryTest != nil {
			if err := m.recoveryTest(); err == nil {
				m.ReportSuccess()
				return
			}
		}
	}

	// Max attempts reached - require user action
	m.mu.Lock()
	m.state = StateInvalid
	m.failureReason = "Recovery failed after maximum attempts. Please re-authenticate."
	m.recoveryCancel = nil
	m.mu.Unlock()

	if m.onStateChange != nil {
		m.onStateChange(StateInvalid, m.failureReason)
	}
}

// TriggerRetry manually restarts recovery. Only works when in StateInvalid.
func (m *Manager) TriggerRetry() {
	m.mu.Lock()
	if m.state != StateInvalid {
		m.mu.Unlock()
		return
	}
	m.mu.Unlock()

	m.startRecovery()
}

// Shutdown cancels any ongoing recovery.
func (m *Manager) Shutdown() {
	m.mu.Lock()
	if m.recoveryCancel != nil {
		m.recoveryCancel()
		m.recoveryCancel = nil
	}
	m.mu.Unlock()
}
```

**Step 4: Run tests to verify they pass**

```bash
go test ./backend/internal/authstate/... -v
```

Expected: PASS

---

## Task 3: Add Recovery Tests

**Files:**
- Modify: `backend/internal/authstate/manager_test.go`

**Step 1: Add tests for recovery behavior**

Add to `manager_test.go`:

```go
func TestRecoverySucceedsOnFirstAttempt(t *testing.T) {
	recoveryAttempts := 0
	m := New(Config{
		MaxAttempts:     4,
		BackoffSchedule: []time.Duration{0, 0, 0, 0}, // no delays for test
		RecoveryTest: func() error {
			recoveryAttempts++
			return nil // success
		},
	})

	m.ReportFailure("token expired")

	// Wait for recovery
	time.Sleep(50 * time.Millisecond)

	state, _ := m.State()
	require.Equal(t, StateValid, state)
	require.Equal(t, 1, recoveryAttempts)
}

func TestRecoveryRetriesOnFailure(t *testing.T) {
	recoveryAttempts := 0
	m := New(Config{
		MaxAttempts:     4,
		BackoffSchedule: []time.Duration{0, 0, 0, 0},
		RecoveryTest: func() error {
			recoveryAttempts++
			if recoveryAttempts < 3 {
				return errors.New("still failing")
			}
			return nil
		},
	})

	m.ReportFailure("token expired")

	time.Sleep(50 * time.Millisecond)

	state, _ := m.State()
	require.Equal(t, StateValid, state)
	require.Equal(t, 3, recoveryAttempts)
}

func TestRecoveryStopsAfterMaxAttempts(t *testing.T) {
	recoveryAttempts := 0
	m := New(Config{
		MaxAttempts:     4,
		BackoffSchedule: []time.Duration{0, 0, 0, 0},
		RecoveryTest: func() error {
			recoveryAttempts++
			return errors.New("always fails")
		},
	})

	m.ReportFailure("token expired")

	time.Sleep(50 * time.Millisecond)

	state, reason := m.State()
	require.Equal(t, StateInvalid, state)
	require.Contains(t, reason, "maximum attempts")
	require.Equal(t, 4, recoveryAttempts)
}

func TestTriggerRetryRestartsRecovery(t *testing.T) {
	attempts := 0
	m := New(Config{
		MaxAttempts:     1,
		BackoffSchedule: []time.Duration{0},
		RecoveryTest: func() error {
			attempts++
			if attempts < 2 {
				return errors.New("fail")
			}
			return nil
		},
	})

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
	require.Equal(t, 2, attempts)
}
```

**Step 2: Run tests**

```bash
go test ./backend/internal/authstate/... -v
```

Expected: PASS (add `"errors"` import if needed)

---

## Task 4: Create Transport Wrapper

**Files:**
- Create: `backend/internal/authstate/transport.go`
- Test: `backend/internal/authstate/transport_test.go`

**Step 1: Write failing tests for transport wrapper**

```go
// backend/internal/authstate/transport_test.go
package authstate

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestTransportBlocksWhenInvalid(t *testing.T) {
	m := New(Config{MaxAttempts: 0})
	m.ReportFailure("token expired")

	transport := m.WrapTransport(http.DefaultTransport)
	req := httptest.NewRequest(http.MethodGet, "http://example.com", nil)

	_, err := transport.RoundTrip(req)

	require.Error(t, err)
	var authErr *AuthInvalidError
	require.ErrorAs(t, err, &authErr)
	require.Equal(t, "token expired", authErr.Reason)
}

func TestTransportAllowsWhenValid(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	m := New(Config{})
	transport := m.WrapTransport(http.DefaultTransport)
	req, _ := http.NewRequest(http.MethodGet, server.URL, nil)

	resp, err := transport.RoundTrip(req)

	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode)
}

func TestTransportReportsFailureOn401(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()

	m := New(Config{MaxAttempts: 0})
	transport := m.WrapTransport(http.DefaultTransport)
	req, _ := http.NewRequest(http.MethodGet, server.URL, nil)

	_, err := transport.RoundTrip(req)

	require.Error(t, err)
	state, _ := m.State()
	require.Equal(t, StateInvalid, state)
}

func TestTransportReportsSuccessOnOK(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	m := New(Config{MaxAttempts: 0})
	m.ReportFailure("was invalid")
	m.mu.Lock()
	m.state = StateRecovering // simulate recovery in progress
	m.mu.Unlock()

	transport := m.WrapTransport(http.DefaultTransport)
	req, _ := http.NewRequest(http.MethodGet, server.URL, nil)

	resp, err := transport.RoundTrip(req)

	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	state, _ := m.State()
	require.Equal(t, StateValid, state)
}
```

**Step 2: Run tests to verify they fail**

```bash
go test ./backend/internal/authstate/... -v -run TestTransport
```

Expected: FAIL - WrapTransport not defined

**Step 3: Write transport wrapper**

```go
// backend/internal/authstate/transport.go
package authstate

import "net/http"

// AuthAwareTransport wraps an http.RoundTripper with auth state checks.
type AuthAwareTransport struct {
	base    http.RoundTripper
	manager *Manager
}

// WrapTransport creates an auth-aware transport wrapper.
func (m *Manager) WrapTransport(base http.RoundTripper) http.RoundTripper {
	if base == nil {
		base = http.DefaultTransport
	}
	return &AuthAwareTransport{
		base:    base,
		manager: m,
	}
}

// RoundTrip implements http.RoundTripper with auth state checks.
func (t *AuthAwareTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	// Check auth state before making request
	state, reason := t.manager.State()
	if state == StateInvalid {
		return nil, &AuthInvalidError{Reason: reason, State: state}
	}

	// Execute the actual request
	resp, err := t.base.RoundTrip(req)
	if err != nil {
		return nil, err
	}

	// Check for auth failure in response
	if resp.StatusCode == http.StatusUnauthorized {
		t.manager.ReportFailure("HTTP 401 Unauthorized")
		return nil, &AuthInvalidError{Reason: "HTTP 401 Unauthorized", State: StateInvalid}
	}

	// On success, notify manager (helps recovery)
	if resp.StatusCode >= 200 && resp.StatusCode < 400 {
		t.manager.ReportSuccess()
	}

	return resp, nil
}
```

**Step 4: Run tests**

```bash
go test ./backend/internal/authstate/... -v
```

Expected: PASS

---

## Task 5: Integrate Auth Manager into App

**Files:**
- Modify: `backend/app.go` - add authManager field and initialization
- Modify: `backend/cluster_clients.go` - wrap transport

**Step 1: Add auth manager field to App struct**

In `backend/app.go`, add to the App struct:

```go
import "github.com/luxury-yacht/app/backend/internal/authstate"

// In App struct, add:
authManager *authstate.Manager
```

**Step 2: Create auth manager initialization function**

Add to `backend/app.go`:

```go
// initAuthManager initializes the centralized auth state manager.
func (a *App) initAuthManager() {
	a.authManager = authstate.New(authstate.Config{
		MaxAttempts:     4,
		BackoffSchedule: []time.Duration{0, 5 * time.Second, 10 * time.Second, 15 * time.Second},
		OnStateChange: func(state authstate.State, reason string) {
			a.handleAuthStateChange(state, reason)
		},
		RecoveryTest: func() error {
			if a.client == nil {
				return errors.New("no kubernetes client")
			}
			_, err := a.client.Discovery().ServerVersion()
			return err
		},
	})
}

// handleAuthStateChange updates connection status based on auth state.
func (a *App) handleAuthStateChange(state authstate.State, reason string) {
	switch state {
	case authstate.StateValid:
		a.updateConnectionStatus(ConnectionStateHealthy, "", 0)
		runtime.EventsEmit(a.Ctx, "auth:recovered")
	case authstate.StateRecovering:
		a.updateConnectionStatus(ConnectionStateRetrying, reason, 0)
	case authstate.StateInvalid:
		a.updateConnectionStatus(ConnectionStateAuthFailed, reason, 0)
		runtime.EventsEmit(a.Ctx, "auth:failed", reason)
	}
}
```

**Step 3: Call initAuthManager during startup**

Find where `setupEnvironment()` is called in `Startup()` and add `initAuthManager()` after it:

```go
a.setupEnvironment()
a.initAuthManager()
```

**Step 4: Wrap transport in cluster_clients.go**

In `buildRestConfigForSelection`, before `return config, nil`, add:

```go
// Wrap transport with auth-aware layer
if a.authManager != nil {
	existingWrap := config.WrapTransport
	config.WrapTransport = func(rt http.RoundTripper) http.RoundTripper {
		if existingWrap != nil {
			rt = existingWrap(rt)
		}
		return a.authManager.WrapTransport(rt)
	}
}
```

**Step 5: Add RetryAuth method for frontend**

Add to `backend/app.go`:

```go
// RetryAuth triggers a manual authentication recovery attempt.
// Called when user clicks "Retry" after re-authenticating externally.
func (a *App) RetryAuth() {
	if a.authManager != nil {
		a.authManager.TriggerRetry()
	}
}
```

**Step 6: Verify compilation**

```bash
go build ./backend/...
```

Expected: SUCCESS

---

## Task 6: Hook Error Capture to Auth Manager

**Files:**
- Modify: `backend/app.go` - connect errorcapture event emitter

**Step 1: Update initAuthManager to hook errorcapture**

Modify `initAuthManager()` to set the event emitter:

```go
import "github.com/luxury-yacht/app/backend/internal/errorcapture"

func (a *App) initAuthManager() {
	a.authManager = authstate.New(authstate.Config{
		// ... existing config ...
	})

	// Hook errorcapture to report exec plugin failures
	errorcapture.SetEventEmitter(func(msg string) {
		if a.authManager != nil {
			a.authManager.ReportFailure(msg)
		}
	})
}
```

**Step 2: Verify compilation**

```bash
go build ./backend/...
```

Expected: SUCCESS

---

## Task 7: Add Frontend Auth Event Handler

**Files:**
- Create: `frontend/src/hooks/useAuthErrorHandler.ts`
- Modify: `frontend/src/App.tsx` - add hook usage

**Step 1: Create the auth error handler hook**

```typescript
// frontend/src/hooks/useAuthErrorHandler.ts

/**
 * Hook for handling authentication failure events from the backend.
 * Shows error toast with retry capability when auth fails.
 */
import { useEffect, useRef } from 'react';
import { useErrorContext } from '@contexts/ErrorContext';
import { ErrorSeverity } from '@utils/errorHandler';

export function useAuthErrorHandler(): void {
  const { addError, errors, dismissError } = useErrorContext();
  const authErrorIdRef = useRef<string | null>(null);

  useEffect(() => {
    const runtime = window.runtime;
    if (!runtime?.EventsOn) {
      return;
    }

    const handleAuthFailed = (reason: string) => {
      // Dismiss any existing auth error first
      if (authErrorIdRef.current) {
        const existing = errors.find(e => e.id === authErrorIdRef.current);
        if (existing) {
          dismissError(authErrorIdRef.current);
        }
      }

      // Create new error with retry capability
      const errorId = `auth-error-${Date.now()}`;
      authErrorIdRef.current = errorId;

      addError({
        id: errorId,
        category: 'AUTHENTICATION',
        userMessage: reason,
        technicalMessage: reason,
        severity: ErrorSeverity.ERROR,
        retryable: true,
        suggestions: ['Re-authenticate externally (e.g., run aws sso login), then click Retry'],
        context: {
          retryFn: async () => {
            await window.go?.backend?.App?.RetryAuth?.();
          },
        },
      });
    };

    const handleAuthRecovered = () => {
      // Dismiss auth error when recovered
      if (authErrorIdRef.current) {
        dismissError(authErrorIdRef.current);
        authErrorIdRef.current = null;
      }
    };

    runtime.EventsOn('auth:failed', handleAuthFailed);
    runtime.EventsOn('auth:recovered', handleAuthRecovered);

    return () => {
      runtime.EventsOff?.('auth:failed');
      runtime.EventsOff?.('auth:recovered');
    };
  }, [addError, dismissError, errors]);
}
```

**Step 2: Add hook to App.tsx**

Find where other hooks are used (like `useBackendErrorHandler`) and add:

```typescript
import { useAuthErrorHandler } from '@hooks/useAuthErrorHandler';

// Inside the App component:
useAuthErrorHandler();
```

**Step 3: Verify frontend compilation**

```bash
cd frontend && npm run build
```

Expected: SUCCESS

---

## Task 8: Add Integration Tests

**Files:**
- Create: `backend/internal/authstate/integration_test.go`

**Step 1: Write integration test**

```go
// backend/internal/authstate/integration_test.go
package authstate

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestFullRecoveryFlow(t *testing.T) {
	// Track server request count
	var requestCount int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count := atomic.AddInt32(&requestCount, 1)
		if count <= 2 {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	var stateHistory []State
	m := New(Config{
		MaxAttempts:     4,
		BackoffSchedule: []time.Duration{0, 10 * time.Millisecond, 10 * time.Millisecond, 10 * time.Millisecond},
		OnStateChange: func(s State, reason string) {
			stateHistory = append(stateHistory, s)
		},
		RecoveryTest: func() error {
			req, _ := http.NewRequest(http.MethodGet, server.URL, nil)
			resp, err := http.DefaultTransport.RoundTrip(req)
			if err != nil {
				return err
			}
			if resp.StatusCode == http.StatusUnauthorized {
				return &AuthInvalidError{Reason: "401"}
			}
			return nil
		},
	})

	// Initial request triggers failure
	transport := m.WrapTransport(http.DefaultTransport)
	req, _ := http.NewRequest(http.MethodGet, server.URL, nil)
	_, err := transport.RoundTrip(req)

	require.Error(t, err)

	// Wait for recovery to complete
	time.Sleep(200 * time.Millisecond)

	// Should be valid after recovery
	state, _ := m.State()
	require.Equal(t, StateValid, state)

	// Verify state transitions: Invalid -> Recovering -> Valid
	require.GreaterOrEqual(t, len(stateHistory), 2)
	require.Equal(t, StateInvalid, stateHistory[0])
}

func TestBlockingDuringRecovery(t *testing.T) {
	m := New(Config{
		MaxAttempts:     4,
		BackoffSchedule: []time.Duration{100 * time.Millisecond, 100 * time.Millisecond, 100 * time.Millisecond, 100 * time.Millisecond},
		RecoveryTest: func() error {
			return nil // will succeed on first attempt after delay
		},
	})

	m.ReportFailure("initial failure")

	// During recovery, all calls should be blocked
	transport := m.WrapTransport(http.DefaultTransport)
	req := httptest.NewRequest(http.MethodGet, "http://example.com", nil)

	var blockedCount int
	for i := 0; i < 5; i++ {
		_, err := transport.RoundTrip(req)
		if err != nil {
			blockedCount++
		}
	}

	// At least some calls should have been blocked
	require.Greater(t, blockedCount, 0)
}
```

**Step 2: Run integration tests**

```bash
go test ./backend/internal/authstate/... -v -run TestFull
go test ./backend/internal/authstate/... -v -run TestBlocking
```

Expected: PASS

---

## Task 9: Shutdown Auth Manager on App Close

**Files:**
- Modify: `backend/app.go` - add shutdown in Shutdown() method

**Step 1: Find the Shutdown or cleanup method in app.go**

Look for `func (a *App) Shutdown()` or similar cleanup function.

**Step 2: Add auth manager shutdown**

```go
// In the Shutdown/cleanup function, add:
if a.authManager != nil {
	a.authManager.Shutdown()
}
```

**Step 3: Verify compilation**

```bash
go build ./backend/...
```

Expected: SUCCESS

---

## Task 10: Run Full Test Suite

**Step 1: Run all backend tests**

```bash
go test ./backend/... -v
```

Expected: PASS

**Step 2: Run frontend tests**

```bash
cd frontend && npm test
```

Expected: PASS

**Step 3: Manual verification**

1. Build and run the app
2. Invalidate your AWS SSO token
3. Verify: single error toast appears (not spam)
4. Verify: error toast has Retry button
5. Run `aws sso login`
6. Click Retry
7. Verify: toast dismisses, app recovers

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Types and errors | `authstate/types.go`, `authstate/errors.go` |
| 2 | Manager core | `authstate/manager.go` |
| 3 | Recovery tests | `authstate/manager_test.go` |
| 4 | Transport wrapper | `authstate/transport.go` |
| 5 | App integration | `app.go`, `cluster_clients.go` |
| 6 | Errorcapture hook | `app.go` |
| 7 | Frontend handler | `useAuthErrorHandler.ts`, `App.tsx` |
| 8 | Integration tests | `authstate/integration_test.go` |
| 9 | Shutdown cleanup | `app.go` |
| 10 | Full test suite | - |
