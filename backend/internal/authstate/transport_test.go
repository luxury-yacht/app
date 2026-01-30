package authstate

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// TestTransportBlocksWhenInvalid verifies that the transport returns an
// AuthInvalidError when the auth state is Invalid.
func TestTransportBlocksWhenInvalid(t *testing.T) {
	// Create a test server that should never be reached
	serverCalled := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		serverCalled = true
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	// Create a manager with recovery disabled so it goes directly to Invalid
	manager := New(Config{
		MaxAttempts: 0, // Disable automatic recovery
	})

	// Force the manager into Invalid state by reporting a failure
	manager.ReportFailure("token expired")

	// Verify state is Invalid
	state, reason := manager.State()
	require.Equal(t, StateInvalid, state)
	require.Equal(t, "token expired", reason)

	// Create an HTTP client with our auth-aware transport
	client := &http.Client{
		Transport: manager.WrapTransport(http.DefaultTransport),
	}

	// Make a request - it should fail immediately without hitting the server
	req, err := http.NewRequest("GET", server.URL, nil)
	require.NoError(t, err)

	resp, err := client.Do(req)

	// Should return an AuthInvalidError
	require.Error(t, err)
	require.Nil(t, resp)

	// Verify it's an AuthInvalidError
	var authErr *AuthInvalidError
	require.ErrorAs(t, err, &authErr)
	require.Equal(t, StateInvalid, authErr.State)

	// Server should never have been called
	require.False(t, serverCalled, "server should not be called when auth is invalid")
}

// TestTransportAllowsWhenValid verifies that the transport allows requests
// when the auth state is Valid.
func TestTransportAllowsWhenValid(t *testing.T) {
	// Create a test server that returns OK
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("success"))
	}))
	defer server.Close()

	// Create a manager in Valid state (default)
	manager := New(Config{
		MaxAttempts: 0,
	})

	// Verify state is Valid
	state, _ := manager.State()
	require.Equal(t, StateValid, state)

	// Create an HTTP client with our auth-aware transport
	client := &http.Client{
		Transport: manager.WrapTransport(http.DefaultTransport),
	}

	// Make a request - it should succeed
	req, err := http.NewRequest("GET", server.URL, nil)
	require.NoError(t, err)

	resp, err := client.Do(req)

	// Should succeed
	require.NoError(t, err)
	require.NotNil(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()
}

// TestTransportBlocksWhenRecovering verifies that the transport blocks requests
// when the auth state is Recovering (to prevent error spam).
func TestTransportBlocksWhenRecovering(t *testing.T) {
	// Create a test server that should never be reached
	serverCalled := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		serverCalled = true
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	// Channel to signal test completion so recovery can stop
	done := make(chan struct{})
	defer close(done)

	// Create a manager with recovery enabled so it goes to Recovering state
	manager := New(Config{
		MaxAttempts:     4,
		BackoffSchedule: []time.Duration{100 * time.Millisecond, 100 * time.Millisecond, 100 * time.Millisecond, 100 * time.Millisecond},
		// Use a recovery test that waits until done channel is closed
		RecoveryTest: func() error {
			<-done
			return errors.New("test ended")
		},
	})
	defer manager.Shutdown()

	// Force the manager into Recovering state
	manager.ReportFailure("token expired")

	// Verify state is Recovering
	state, _ := manager.State()
	require.Equal(t, StateRecovering, state)

	// Create an HTTP client with our auth-aware transport
	client := &http.Client{
		Transport: manager.WrapTransport(http.DefaultTransport),
	}

	// Make a request - it should be blocked
	req, err := http.NewRequest("GET", server.URL, nil)
	require.NoError(t, err)

	resp, err := client.Do(req)

	// Should return an AuthInvalidError
	require.Error(t, err)
	require.Nil(t, resp)

	// Verify it's an AuthInvalidError with Recovering state
	var authErr *AuthInvalidError
	require.ErrorAs(t, err, &authErr)
	require.Equal(t, StateRecovering, authErr.State)

	// Server should never have been called
	require.False(t, serverCalled, "server should not be called when auth is recovering")
}

// TestTransportReportsFailureOn401 verifies that the transport reports auth
// failures when receiving a 401 response.
func TestTransportReportsFailureOn401(t *testing.T) {
	// Create a test server that returns 401 Unauthorized
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()

	// Track state changes
	var stateChanges []State
	manager := New(Config{
		MaxAttempts: 0, // Disable recovery so we go directly to Invalid
		OnStateChange: func(state State, reason string) {
			stateChanges = append(stateChanges, state)
		},
	})

	// Verify initial state is Valid
	state, _ := manager.State()
	require.Equal(t, StateValid, state)

	// Create an HTTP client with our auth-aware transport
	client := &http.Client{
		Transport: manager.WrapTransport(http.DefaultTransport),
	}

	// Make a request - server will return 401
	req, err := http.NewRequest("GET", server.URL, nil)
	require.NoError(t, err)

	resp, err := client.Do(req)

	// Should return an AuthInvalidError (transport detected 401)
	require.Error(t, err)
	require.Nil(t, resp)

	var authErr *AuthInvalidError
	require.ErrorAs(t, err, &authErr)

	// Manager should now be in Invalid state
	state, _ = manager.State()
	require.Equal(t, StateInvalid, state)

	// State should have changed to Invalid
	require.Contains(t, stateChanges, StateInvalid)
}

// TestTransportSuccessKeepsValidState verifies that the transport keeps state
// Valid when receiving 2xx or 3xx responses.
func TestTransportSuccessKeepsValidState(t *testing.T) {
	testCases := []struct {
		name       string
		statusCode int
	}{
		{"200 OK", http.StatusOK},
		{"201 Created", http.StatusCreated},
		{"204 No Content", http.StatusNoContent},
		{"301 Moved Permanently", http.StatusMovedPermanently},
		{"302 Found", http.StatusFound},
		{"304 Not Modified", http.StatusNotModified},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Create a test server that returns the status code
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.statusCode)
			}))
			defer server.Close()

			// Track state changes
			var stateChanges []State
			manager := New(Config{
				MaxAttempts: 0, // Disable recovery for this test
				OnStateChange: func(state State, reason string) {
					stateChanges = append(stateChanges, state)
				},
			})

			// Verify state is Valid
			state, _ := manager.State()
			require.Equal(t, StateValid, state)

			// Create an HTTP client with our auth-aware transport
			client := &http.Client{
				Transport: manager.WrapTransport(http.DefaultTransport),
			}

			// Make a request - server will return success
			req, err := http.NewRequest("GET", server.URL, nil)
			require.NoError(t, err)

			resp, err := client.Do(req)

			// Should succeed
			require.NoError(t, err)
			require.NotNil(t, resp)
			require.Equal(t, tc.statusCode, resp.StatusCode)
			resp.Body.Close()

			// Manager should still be in Valid state
			state, _ = manager.State()
			require.Equal(t, StateValid, state)

			// No state changes should have occurred
			require.Empty(t, stateChanges)
		})
	}
}

// TestTransportPassesThrough4xxErrors verifies that the transport passes through
// 4xx and 5xx errors (other than 401) without changing state.
func TestTransportPassesThrough4xxErrors(t *testing.T) {
	testCases := []struct {
		name       string
		statusCode int
	}{
		{"400 Bad Request", http.StatusBadRequest},
		{"403 Forbidden", http.StatusForbidden},
		{"404 Not Found", http.StatusNotFound},
		{"500 Internal Server Error", http.StatusInternalServerError},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Create a test server that returns the status code
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.statusCode)
			}))
			defer server.Close()

			// Track state changes
			var stateChanges []State
			manager := New(Config{
				MaxAttempts: 0, // Disable recovery for this test
				OnStateChange: func(state State, reason string) {
					stateChanges = append(stateChanges, state)
				},
			})

			// Verify state is Valid
			state, _ := manager.State()
			require.Equal(t, StateValid, state)

			// Create an HTTP client with our auth-aware transport
			client := &http.Client{
				Transport: manager.WrapTransport(http.DefaultTransport),
			}

			// Make a request - server will return error
			req, err := http.NewRequest("GET", server.URL, nil)
			require.NoError(t, err)

			resp, err := client.Do(req)

			// Should succeed (transport passes through non-401 errors)
			require.NoError(t, err)
			require.NotNil(t, resp)
			require.Equal(t, tc.statusCode, resp.StatusCode)
			resp.Body.Close()

			// Manager should still be in Valid state
			state, _ = manager.State()
			require.Equal(t, StateValid, state)

			// State should not have changed
			require.Empty(t, stateChanges)
		})
	}
}

// TestTransportUsesDefaultTransportWhenNil verifies that WrapTransport
// uses http.DefaultTransport when nil is passed.
func TestTransportUsesDefaultTransportWhenNil(t *testing.T) {
	// Create a test server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	// Create a manager
	manager := New(Config{
		MaxAttempts: 0,
	})

	// Wrap nil transport - should use DefaultTransport
	transport := manager.WrapTransport(nil)
	require.NotNil(t, transport)

	// Create an HTTP client with the transport
	client := &http.Client{
		Transport: transport,
	}

	// Make a request - should work with DefaultTransport
	req, err := http.NewRequest("GET", server.URL, nil)
	require.NoError(t, err)

	resp, err := client.Do(req)
	require.NoError(t, err)
	require.NotNil(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()
}

// TestTransportPassesThroughNetworkErrors verifies that network errors
// are passed through without modification.
func TestTransportPassesThroughNetworkErrors(t *testing.T) {
	// Create a manager in Valid state
	manager := New(Config{
		MaxAttempts: 0,
	})

	// Create an HTTP client with our auth-aware transport
	client := &http.Client{
		Transport: manager.WrapTransport(http.DefaultTransport),
	}

	// Make a request to an invalid address - will cause a network error
	req, err := http.NewRequest("GET", "http://invalid.localhost.invalid:12345", nil)
	require.NoError(t, err)

	resp, err := client.Do(req)

	// Should return a network error, not an AuthInvalidError
	require.Error(t, err)
	require.Nil(t, resp)

	// Should NOT be an AuthInvalidError
	var authErr *AuthInvalidError
	require.False(t, errors.As(err, &authErr), "network errors should not be converted to AuthInvalidError")

	// Manager should still be in Valid state (network error doesn't change auth state)
	state, _ := manager.State()
	require.Equal(t, StateValid, state)
}

// mockErrorTransport is a transport that always returns an error.
type mockErrorTransport struct {
	err error
}

func (m *mockErrorTransport) RoundTrip(_ *http.Request) (*http.Response, error) {
	return nil, m.err
}

// TestTransportReportsFailureOnCredentialError verifies that the transport
// reports auth failures when the underlying transport returns a credential error.
// This is important for AWS SSO and other exec credential providers that fail
// before an HTTP request is even made.
func TestTransportReportsFailureOnCredentialError(t *testing.T) {
	testCases := []struct {
		name     string
		errMsg   string
		isAuthErr bool
	}{
		{
			name:     "AWS exec credential failure",
			errMsg:   "getting credentials: exec: executable aws failed with exit code 255",
			isAuthErr: true,
		},
		{
			name:     "Token expired",
			errMsg:   "token has expired",
			isAuthErr: true,
		},
		{
			name:     "SSO session error",
			errMsg:   "sso session has expired",
			isAuthErr: true,
		},
		{
			name:     "Regular network error",
			errMsg:   "dial tcp: connection refused",
			isAuthErr: false,
		},
		{
			name:     "DNS resolution failure",
			errMsg:   "lookup example.com: no such host",
			isAuthErr: false,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Track state changes
			var stateChanges []State
			manager := New(Config{
				MaxAttempts: 0, // Disable recovery so we go directly to Invalid
				OnStateChange: func(state State, reason string) {
					stateChanges = append(stateChanges, state)
				},
			})

			// Verify initial state is Valid
			state, _ := manager.State()
			require.Equal(t, StateValid, state)

			// Create a transport that returns the test error
			mockTransport := &mockErrorTransport{err: errors.New(tc.errMsg)}

			// Wrap with auth-aware transport
			client := &http.Client{
				Transport: manager.WrapTransport(mockTransport),
			}

			// Make a request
			req, err := http.NewRequest("GET", "http://example.com", nil)
			require.NoError(t, err)

			resp, err := client.Do(req)

			// Both cases should return an error
			require.Error(t, err)
			require.Nil(t, resp)

			if tc.isAuthErr {
				// Should be an AuthInvalidError
				var authErr *AuthInvalidError
				require.ErrorAs(t, err, &authErr, "credential errors should be converted to AuthInvalidError")

				// Manager should now be in Invalid state
				state, _ = manager.State()
				require.Equal(t, StateInvalid, state)

				// State should have changed to Invalid
				require.Contains(t, stateChanges, StateInvalid)
			} else {
				// Should NOT be an AuthInvalidError
				var authErr *AuthInvalidError
				require.False(t, errors.As(err, &authErr), "non-credential errors should not be converted to AuthInvalidError")

				// Manager should still be in Valid state
				state, _ = manager.State()
				require.Equal(t, StateValid, state)

				// No state changes should have occurred
				require.Empty(t, stateChanges)
			}
		})
	}
}
