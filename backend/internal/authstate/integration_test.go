package authstate

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// TestFullRecoveryFlow tests the complete recovery flow:
// 1. Start in Valid state
// 2. Receive 401 -> transition to Recovering
// 3. Recovery test fails initially
// 4. Recovery test succeeds -> transition to Valid
func TestFullRecoveryFlow(t *testing.T) {
	// Track recovery attempts and control when they succeed.
	var recoveryAttempts atomic.Int32
	successOnAttempt := 3 // Succeed on the 3rd attempt

	// Track state changes.
	var stateChanges []State
	var stateChangesMu sync.Mutex

	manager := New(Config{
		MaxAttempts:     4,
		BackoffSchedule: []time.Duration{0, 10 * time.Millisecond, 10 * time.Millisecond, 10 * time.Millisecond},
		OnStateChange: func(state State, reason string) {
			stateChangesMu.Lock()
			stateChanges = append(stateChanges, state)
			stateChangesMu.Unlock()
		},
		RecoveryTest: func() error {
			attempt := int(recoveryAttempts.Add(1))
			if attempt >= successOnAttempt {
				return nil // Success
			}
			return &AuthInvalidError{Reason: "still invalid"}
		},
	})
	defer manager.Shutdown()

	// Create a test server that returns 401 on first request, then 200.
	var requestCount atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count := int(requestCount.Add(1))
		if count == 1 {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	// Verify initial state is Valid.
	state, _ := manager.State()
	require.Equal(t, StateValid, state)

	// Create an HTTP client with auth-aware transport.
	client := &http.Client{
		Transport: manager.WrapTransport(http.DefaultTransport),
	}

	// First request - server returns 401, should trigger recovery.
	req, err := http.NewRequest("GET", server.URL, nil)
	require.NoError(t, err)

	resp, err := client.Do(req)
	require.Error(t, err)
	require.Nil(t, resp)

	var authErr *AuthInvalidError
	require.ErrorAs(t, err, &authErr)

	// State should now be Recovering (recovery was triggered).
	state, _ = manager.State()
	require.Equal(t, StateRecovering, state)

	// Wait for recovery to complete (should take ~30ms with backoff schedule).
	time.Sleep(100 * time.Millisecond)

	// State should now be Valid (recovery succeeded on 3rd attempt).
	state, _ = manager.State()
	require.Equal(t, StateValid, state)

	// Verify state transitions occurred.
	stateChangesMu.Lock()
	transitions := append([]State(nil), stateChanges...)
	stateChangesMu.Unlock()

	require.Contains(t, transitions, StateRecovering, "should have transitioned to Recovering")
	require.Contains(t, transitions, StateValid, "should have transitioned to Valid")

	// Verify recovery was attempted multiple times.
	require.GreaterOrEqual(t, int(recoveryAttempts.Load()), successOnAttempt)
}

// TestBlockingDuringInvalidState tests that requests are blocked when auth
// state is Invalid.
func TestBlockingDuringInvalidState(t *testing.T) {
	// Create a server that tracks if it was called.
	var serverCalled atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		serverCalled.Store(true)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	// Create manager with recovery disabled (goes directly to Invalid).
	manager := New(Config{
		MaxAttempts: 0,
	})

	// Force into Invalid state.
	manager.ReportFailure("token expired")

	// Verify state is Invalid.
	state, _ := manager.State()
	require.Equal(t, StateInvalid, state)

	// Create an HTTP client with auth-aware transport.
	client := &http.Client{
		Transport: manager.WrapTransport(http.DefaultTransport),
	}

	// Make multiple requests - all should be blocked.
	for i := 0; i < 5; i++ {
		req, err := http.NewRequest("GET", server.URL, nil)
		require.NoError(t, err)

		resp, err := client.Do(req)
		require.Error(t, err)
		require.Nil(t, resp)

		var authErr *AuthInvalidError
		require.ErrorAs(t, err, &authErr)
		require.Equal(t, StateInvalid, authErr.State)
	}

	// Server should never have been called.
	require.False(t, serverCalled.Load(), "server should not be called when auth is invalid")
}

// TestRecoverySuccessViaRecoveryTest tests that the RecoveryTest callback
// can transition state from Recovering to Valid.
func TestRecoverySuccessViaRecoveryTest(t *testing.T) {
	// Track state changes.
	var stateChanges []State
	var stateChangesMu sync.Mutex

	// Create manager with recovery that succeeds on first try.
	manager := New(Config{
		MaxAttempts:     4,
		BackoffSchedule: []time.Duration{0, 0, 0, 0}, // No delay
		OnStateChange: func(state State, reason string) {
			stateChangesMu.Lock()
			stateChanges = append(stateChanges, state)
			stateChangesMu.Unlock()
		},
		RecoveryTest: func() error {
			return nil // Success
		},
	})
	defer manager.Shutdown()

	// Force into Recovering state.
	manager.ReportFailure("token expired")

	// Wait for recovery to complete.
	time.Sleep(50 * time.Millisecond)

	// State should now be Valid (recovery succeeded).
	state, _ := manager.State()
	require.Equal(t, StateValid, state)

	// Verify state transitions.
	stateChangesMu.Lock()
	transitions := append([]State(nil), stateChanges...)
	stateChangesMu.Unlock()

	require.Contains(t, transitions, StateRecovering, "should have transitioned to Recovering")
	require.Contains(t, transitions, StateValid, "should have transitioned to Valid")
}

// TestManualRetryFromInvalid tests that TriggerRetry works from Invalid state.
func TestManualRetryFromInvalid(t *testing.T) {
	// Track state changes.
	var stateChanges []State
	var stateChangesMu sync.Mutex

	// Control when recovery succeeds.
	recoverySucceed := make(chan struct{})

	manager := New(Config{
		MaxAttempts:     4,
		BackoffSchedule: []time.Duration{0, 0, 0, 0},
		OnStateChange: func(state State, reason string) {
			stateChangesMu.Lock()
			stateChanges = append(stateChanges, state)
			stateChangesMu.Unlock()
		},
		RecoveryTest: func() error {
			select {
			case <-recoverySucceed:
				return nil
			default:
				return &AuthInvalidError{Reason: "still invalid"}
			}
		},
	})
	defer manager.Shutdown()

	// Force failure to start recovery, then wait for it to exhaust attempts.
	manager.ReportFailure("initial failure")

	// Wait for recovery to exhaust attempts and go to Invalid.
	time.Sleep(50 * time.Millisecond)

	state, _ := manager.State()
	require.Equal(t, StateInvalid, state, "should be in Invalid after exhausting attempts")

	// Now make recovery succeed.
	close(recoverySucceed)

	// Trigger manual retry.
	manager.TriggerRetry()

	// Wait for recovery to complete.
	time.Sleep(50 * time.Millisecond)

	// State should now be Valid.
	state, _ = manager.State()
	require.Equal(t, StateValid, state, "should be Valid after manual retry")

	// Verify we went through Recovering.
	stateChangesMu.Lock()
	transitions := append([]State(nil), stateChanges...)
	stateChangesMu.Unlock()

	// Find the sequence: should see Recovering (from initial), Invalid, Recovering (from retry), Valid.
	var foundRecoveringAfterInvalid bool
	for i := 0; i < len(transitions)-1; i++ {
		if transitions[i] == StateInvalid && transitions[i+1] == StateRecovering {
			foundRecoveringAfterInvalid = true
			break
		}
	}
	require.True(t, foundRecoveringAfterInvalid, "should transition from Invalid to Recovering on TriggerRetry")
}

// TestConcurrentRequestsBlockedDuringRecovery tests that concurrent requests
// are all blocked during Recovering state (to prevent error spam).
func TestConcurrentRequestsBlockedDuringRecovery(t *testing.T) {
	// Create a server that should never be reached.
	var serverCalled atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		serverCalled.Store(true)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	// Channel to control recovery test.
	recoveryDone := make(chan struct{})

	manager := New(Config{
		MaxAttempts:     4,
		BackoffSchedule: []time.Duration{100 * time.Millisecond, 100 * time.Millisecond, 100 * time.Millisecond, 100 * time.Millisecond},
		RecoveryTest: func() error {
			select {
			case <-recoveryDone:
				return nil
			default:
				return &AuthInvalidError{Reason: "still recovering"}
			}
		},
	})
	defer manager.Shutdown()
	defer close(recoveryDone)

	// Start in Recovering state.
	manager.ReportFailure("initial failure")

	state, _ := manager.State()
	require.Equal(t, StateRecovering, state)

	// Create an HTTP client with auth-aware transport.
	client := &http.Client{
		Transport: manager.WrapTransport(http.DefaultTransport),
	}

	// Launch concurrent requests.
	const numRequests = 10
	var wg sync.WaitGroup
	results := make(chan error, numRequests)

	for i := 0; i < numRequests; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			req, err := http.NewRequest("GET", server.URL, nil)
			if err != nil {
				results <- err
				return
			}
			resp, err := client.Do(req)
			if err != nil {
				results <- err
				return
			}
			resp.Body.Close()
			results <- nil
		}()
	}

	wg.Wait()
	close(results)

	// During Recovering state, all requests should be blocked.
	var authErrors int
	for err := range results {
		var authErr *AuthInvalidError
		if errors.As(err, &authErr) && authErr.State == StateRecovering {
			authErrors++
		}
	}

	// All requests should have returned AuthInvalidError with Recovering state.
	require.Equal(t, numRequests, authErrors, "all requests should be blocked during recovery")

	// Server should never have been called.
	require.False(t, serverCalled.Load(), "server should not be called during recovery")
}
