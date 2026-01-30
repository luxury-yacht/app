# Centralized Auth State Manager

## Problem

When authentication tokens expire (e.g., AWS SSO), the app floods logs with errors (3-4 per second) because:
- Multiple components make independent API calls
- Each call triggers the auth exec plugin independently
- No caching of auth failures
- No coordination between components during recovery

## Goals

1. **Primary**: Reduce error spam by centralizing auth failure detection and recovery
2. **Secondary**: Improve UX with clear feedback and retry capability

## Scope

**Auth types covered:**
- Exec plugins (AWS, GKE, Azure) - detected via stderr patterns
- HTTP 401 responses - detected via transport wrapper

**Out of scope:**
- Certificate-based auth (rarely expires)
- Proactive token refresh (handled by exec plugins)

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Auth State Manager                          │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ state: VALID | INVALID | RECOVERING                           │  │
│  │ recoveryAttempts: 0-4                                         │  │
│  │ lastFailure: time.Time                                        │  │
│  │ failureReason: string                                         │  │
│  └───────────────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ▼                 ▼                 ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ Transport       │ │ Error Capture   │ │ Connection      │
│ Wrapper         │ │ Hook            │ │ Status          │
│ (detects 401s)  │ │ (detects exec)  │ │ (notifies UI)   │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

## State Machine

```
VALID → INVALID (on 401 or exec failure)
INVALID → RECOVERING (automatic, immediate)
RECOVERING → VALID (on successful API call)
RECOVERING → INVALID (after 4 failed attempts, requires user action)
INVALID → RECOVERING (on user retry trigger)
```

## Components

### Auth State Manager

**File:** `backend/internal/authstate/manager.go`

```go
type State int

const (
    StateValid State = iota
    StateInvalid
    StateRecovering
)

type Manager struct {
    mu               sync.RWMutex
    state            State
    recoveryAttempts int
    lastFailure      time.Time
    failureReason    string

    // Callbacks
    onStateChange    func(State, string)  // notifies connection status
    recoveryTest     func() error         // tests if auth works

    // Recovery control
    recoveryCancel   context.CancelFunc
    maxAttempts      int                  // default: 4
    backoffSchedule  []time.Duration      // default: [0s, 5s, 10s, 15s]
}
```

**Key methods:**

| Method | Purpose |
|--------|---------|
| `ReportFailure(reason string)` | Called by transport/errorcapture when auth fails. Transitions to INVALID and starts recovery. |
| `ReportSuccess()` | Called by transport on successful API call. Resets state to VALID. |
| `IsValid() bool` | Fast check for transport wrapper - returns false if INVALID or RECOVERING. |
| `TriggerRetry()` | Called by frontend when user clicks retry. Restarts recovery if in INVALID state. |
| `State() (State, string)` | Returns current state and reason for UI display. |

**Deduplication:** If already INVALID or RECOVERING, `ReportFailure` is ignored. Only the first failure triggers recovery.

### Transport Wrapper

**File:** `backend/internal/authstate/transport.go`

```go
type AuthAwareTransport struct {
    base    http.RoundTripper
    manager *Manager
}

func (t *AuthAwareTransport) RoundTrip(req *http.Request) (*http.Response, error) {
    // 1. Check auth state before making request
    if !t.manager.IsValid() {
        return nil, &AuthInvalidError{
            Reason: t.manager.failureReason,
            State:  t.manager.state,
        }
    }

    // 2. Execute the actual request
    resp, err := t.base.RoundTrip(req)

    // 3. Check for auth failure in response
    if resp != nil && resp.StatusCode == http.StatusUnauthorized {
        t.manager.ReportFailure("HTTP 401 Unauthorized")
        return nil, &AuthInvalidError{Reason: "HTTP 401 Unauthorized"}
    }

    // 4. On success, notify manager
    if err == nil && resp != nil && resp.StatusCode < 400 {
        t.manager.ReportSuccess()
    }

    return resp, err
}
```

### Custom Error Type

**File:** `backend/internal/authstate/errors.go`

```go
type AuthInvalidError struct {
    Reason string
    State  State
}

func (e *AuthInvalidError) Error() string {
    return fmt.Sprintf("auth invalid: %s", e.Reason)
}
```

## Integration Points

### cluster_clients.go

Wrap transport when building rest.Config:

```go
func (a *App) buildRestConfigForSelection(selection kubeconfigSelection) (*rest.Config, error) {
    // ... existing code ...

    config.WrapTransport = func(rt http.RoundTripper) http.RoundTripper {
        return a.authManager.WrapTransport(rt)
    }

    return config, nil
}
```

### app.go

Initialize auth manager and hook errorcapture:

```go
func (a *App) initAuthManager() {
    a.authManager = authstate.New(authstate.Config{
        MaxAttempts:     4,
        BackoffSchedule: []time.Duration{0, 5 * time.Second, 10 * time.Second, 15 * time.Second},
        OnStateChange: func(state authstate.State, reason string) {
            a.updateConnectionStatusFromAuth(state, reason)
        },
        RecoveryTest: func() error {
            _, err := a.client.Discovery().ServerVersion()
            return err
        },
    })

    errorcapture.SetEventEmitter(func(msg string) {
        if a.authManager != nil {
            a.authManager.ReportFailure(msg)
        }
    })
}
```

### app_connection_status.go

Map auth states to connection states:

```go
func (a *App) updateConnectionStatusFromAuth(state authstate.State, reason string) {
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

### Frontend Event Subscription

Subscribe to auth events and use existing error toast:

```typescript
EventsOn("auth:failed", (reason: string) => {
  addError({
    category: "AUTHENTICATION",
    userMessage: reason,
    severity: "error",
    retryable: true,
    autoDismiss: false,
    suggestions: ["Re-authenticate externally, then click Retry"],
    context: {
      retryFn: async () => { await window.go.backend.App.RetryAuth(); }
    }
  });
});

EventsOn("auth:recovered", () => {
  dismissErrorsByCategory("AUTHENTICATION");
});
```

## Recovery Timeline

| Time | Event |
|------|-------|
| 0s | Auth fails, state → RECOVERING, attempt 1 (immediate) |
| 5s | Attempt 2 |
| 15s | Attempt 3 |
| 30s | Attempt 4 |
| 30s+ | State → INVALID, user action required |

## File Changes Summary

**New files:**
- `backend/internal/authstate/manager.go` - Auth state machine
- `backend/internal/authstate/transport.go` - HTTP transport wrapper
- `backend/internal/authstate/errors.go` - AuthInvalidError type

**Modified files:**
- `backend/app.go` - Initialize auth manager, hook errorcapture
- `backend/cluster_clients.go` - Wrap transport in buildRestConfigForSelection
- `backend/app_connection_status.go` - Map auth states to connection states
- `frontend/src/App.tsx` (or similar) - Subscribe to auth events

## What This Fixes

- Error spam eliminated - first failure triggers recovery, subsequent calls blocked
- Single recovery loop instead of N parallel components retrying
- User gets clear feedback via existing toast with retry button
- Automatic recovery for transient issues (30s window), user prompt for persistent ones

## What Stays The Same

- Existing errorcapture patterns (reused, no changes)
- Existing ErrorNotificationSystem component (reused, no changes)
- Existing connection status states (reused)
