# Auth State Manager

The auth state manager (`backend/internal/authstate`) provides centralized authentication failure detection and recovery for Kubernetes cluster connections.

## Overview

When authentication fails (expired SSO token, revoked credentials, etc.), the auth manager:

1. Detects the failure via HTTP 401 responses or credential provider errors
2. Transitions to a recovering state and attempts automatic recovery
3. Emits events to the frontend to display appropriate UI
4. Either recovers successfully or transitions to invalid state requiring user action

Each cluster has its own independent auth manager instance, ensuring failures in one cluster don't affect others.

## State Machine

```
                 ┌────────────────────────────────────┐
                 │                                    │
                 ▼                                    │
┌─────────┐  ReportFailure()  ┌────────────┐  success │
│  Valid  │ ───────────────▶  │ Recovering │ ─────────┘
└─────────┘                   └────────────┘
     ▲                              │
     │                              │ max attempts
     │        TriggerRetry()        │ exhausted
     │       ┌─────────────┐        │
     └────── │   Invalid   │ ◀──────┘
             └─────────────┘
```

| State             | Description                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| `StateValid`      | Authentication is working. All API requests proceed normally.                                        |
| `StateRecovering` | Auth failed, automatic recovery in progress. API requests during recovery return `AuthInvalidError`. |
| `StateInvalid`    | Recovery failed after max attempts. User action required (e.g., `aws sso login`).                    |

## Package Structure

```
backend/internal/authstate/
├── types.go          # State enum and String() method
├── errors.go         # AuthInvalidError type
├── manager.go        # Core state machine and recovery logic
├── transport.go      # HTTP transport wrapper for 401 detection
├── manager_test.go   # Unit tests
├── transport_test.go # Transport wrapper tests
└── integration_test.go # Full flow integration tests
```

## Key Components

### Manager

The `Manager` struct (`manager.go`) coordinates auth state:

```go
manager := authstate.New(authstate.Config{
    MaxAttempts:     4,
    BackoffSchedule: []time.Duration{0, 5*time.Second, 10*time.Second, 15*time.Second},
    OnStateChange: func(state authstate.State, reason string) {
        // Handle state transitions (emit events, update UI, etc.)
    },
    OnRecoveryProgress: func(progress authstate.RecoveryProgress) {
        // Handle countdown updates for UI
    },
    RecoveryTest: func() error {
        // Test if auth is working (e.g., call Discovery().ServerVersion())
        return nil // nil = success, error = still failing
    },
})
```

Key methods:

| Method                  | Description                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `ReportFailure(reason)` | Report an auth failure. Idempotent - subsequent calls while invalid/recovering are ignored. |
| `ReportSuccess()`       | Report successful auth. Resets state to Valid.                                              |
| `TriggerRetry()`        | Manually trigger recovery (user clicked Retry). Interrupts ongoing auto-recovery.           |
| `State()`               | Returns current `(State, reason)`.                                                          |
| `IsValid()`             | Returns `true` if state is Valid.                                                           |
| `RecoveryInfo()`        | Returns `RecoveryProgress` with attempt count and countdown.                                |
| `Shutdown()`            | Cancel any ongoing recovery. Call during app shutdown.                                      |
| `SetRecoveryTest(fn)`   | Set the recovery test function after initialization.                                        |

### Transport Wrapper

The `WrapTransport` method (`transport.go`) creates an HTTP transport that:

1. **Blocks requests** when auth is Invalid (returns `AuthInvalidError`)
2. **Detects 401 responses** and reports them as auth failures
3. **Reports success** on 2xx/3xx responses (helps recovery)

```go
config.WrapTransport = func(rt http.RoundTripper) http.RoundTripper {
    return authManager.WrapTransport(rt)
}
```

### Recovery Test

The recovery test function determines if authentication is working. For Kubernetes clusters, this typically rebuilds credentials from the kubeconfig to pick up refreshed SSO tokens:

```go
clusterAuthMgr.SetRecoveryTest(func() error {
    // Rebuild from kubeconfig to get fresh credentials
    loadingRules := clientcmd.NewDefaultClientConfigLoadingRules()
    loadingRules.ExplicitPath = kubeconfigPath
    clientConfig := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loadingRules, overrides)
    freshConfig, err := clientConfig.ClientConfig()
    if err != nil {
        return err
    }

    freshClient, err := kubernetes.NewForConfig(freshConfig)
    if err != nil {
        return err
    }

    // Test connectivity
    _, err = freshClient.Discovery().ServerVersion()
    return err
})
```

**Important**: Don't use the existing clientset for recovery tests - it caches stale credentials. Always rebuild from the kubeconfig.

## Detection Mechanisms

Auth failures are detected through multiple channels:

### 1. HTTP 401 Responses (Immediate)

The transport wrapper intercepts every API request. If the Kubernetes API server returns 401 Unauthorized, auth failure is reported immediately.

```go
// transport.go:73-75
if resp.StatusCode == http.StatusUnauthorized {
    t.manager.ReportFailure("401 Unauthorized")
}
```

### 2. Credential Provider Errors (Immediate)

Exec credential providers (like `aws eks get-token`) can fail before an HTTP request is made. These are caught by:

- The pre-flight check during client initialization (`cluster_clients.go`)
- The `isCredentialError()` function which matches common error patterns

```go
// Patterns that indicate credential/auth failures
credentialPatterns := []string{
    "getting credentials",
    "exec: executable",
    "failed with exit code",
    "token has expired",
    "sso session",
    // ... etc
}
```

### 3. Heartbeat (Every 15 seconds)

If the cluster is idle, the heartbeat detects failures:

```go
// config.go:78
StreamHeartbeatInterval = 15 * time.Second
```

## Frontend Integration

### Events

The backend emits these events via Wails runtime:

| Event                     | Payload                                                                    | Description                 |
| ------------------------- | -------------------------------------------------------------------------- | --------------------------- |
| `cluster:auth:failed`     | `{clusterId, clusterName, reason}`                                         | Auth failure detected       |
| `cluster:auth:recovering` | `{clusterId, clusterName, reason}`                                         | Recovery started            |
| `cluster:auth:recovered`  | `{clusterId, clusterName}`                                                 | Auth recovered successfully |
| `cluster:auth:progress`   | `{clusterId, clusterName, currentAttempt, maxAttempts, secondsUntilRetry}` | Recovery countdown update   |

### React Context

The `AuthErrorContext` (`frontend/src/core/contexts/AuthErrorContext.tsx`) provides:

- Per-cluster auth state tracking
- `useActiveClusterAuthState(clusterId)` hook for overlay display
- `handleRetry(clusterId)` to trigger manual retry

### Auth Failure Overlay

The `AuthFailureOverlay` component blocks access to a cluster with auth failure, showing:

- Error reason
- Recovery progress (attempt N of M)
- Countdown to next retry
- Retry Now button (always enabled, interrupts auto-recovery)

## Troubleshooting

### Auth failure not detected

1. **Check heartbeat interval**: If idle, failures may take up to 15 seconds to detect
2. **Check credential caching**: AWS tokens are valid for ~15 minutes after revocation
3. **Enable debug logging**: Look for "Pre-flight check" and "Heartbeat" log messages

### Recovery not working

1. **Verify recovery test function**: It must rebuild credentials from kubeconfig, not use cached clientset
2. **Check SSO token refresh**: Run `aws sso login` or equivalent before clicking Retry
3. **Check logs**: Look for "Recovery failed" or "Cluster X: auth recovering" messages

### Multiple auth errors appearing

1. **Ensure per-cluster isolation**: Each cluster should have its own `authstate.Manager`
2. **Check transport wrapper**: Verify `WrapTransport` is called with the cluster's auth manager
3. **Check event handlers**: Frontend should track errors per `clusterId`

## Adding New Auth Detection

To add a new auth failure detection mechanism:

1. Call `authManager.ReportFailure(reason)` when failure is detected
2. Ensure idempotency - multiple reports for the same failure are ignored
3. Use cluster-specific auth manager, not a global one

Example:

```go
if isNewAuthFailureCondition(err) {
    clients := app.clusterClientsForID(clusterID)
    if clients != nil && clients.authManager != nil {
        clients.authManager.ReportFailure("descriptive reason")
    }
}
```

## Testing

Run auth state tests:

```bash
cd backend && go test ./internal/authstate/... -v
```

Key test files:

- `manager_test.go` - State transitions, idempotency, recovery
- `transport_test.go` - 401 detection, blocking during invalid state
- `integration_test.go` - Full recovery flow

## Related Files

| File                                                      | Purpose                           |
| --------------------------------------------------------- | --------------------------------- |
| `backend/internal/authstate/`                             | Core auth state package           |
| `backend/cluster_clients.go`                              | Per-cluster auth manager creation |
| `backend/cluster_auth.go`                                 | Auth state change handlers        |
| `backend/app_heartbeat.go`                                | Periodic health checks            |
| `frontend/src/core/contexts/AuthErrorContext.tsx`         | React context for auth state      |
| `frontend/src/ui/overlays/AuthFailureOverlay.tsx` | Auth failure UI                   |
| `frontend/src/hooks/useAuthErrorHandler.ts`               | Auth event handling hook          |
