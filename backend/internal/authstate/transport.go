package authstate

import (
	"net/http"
	"strings"
)

// AuthAwareTransport wraps an http.RoundTripper with auth state checks.
// It blocks requests when auth state is Invalid and reports 401 responses
// as auth failures to the manager.
type AuthAwareTransport struct {
	// base is the underlying transport used for actual HTTP requests.
	base http.RoundTripper

	// manager is the auth state manager used for checking and reporting state.
	manager *Manager
}

// WrapTransport creates an auth-aware transport wrapper that intercepts HTTP
// requests to check authentication state and report auth-related responses.
//
// The returned transport:
//   - Blocks requests when auth state is Invalid or Recovering (returns AuthInvalidError)
//   - Allows requests when auth state is Valid
//   - Reports 401 responses as auth failures to the manager
//   - Reports successful responses (2xx/3xx) to the manager
//
// If base is nil, http.DefaultTransport is used.
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
// It checks the current auth state before making the request and handles
// the response to report auth-related status codes.
func (t *AuthAwareTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	// Step 1: Check current auth state - block if Invalid or Recovering
	// We block during Recovering to prevent error spam. Recovery is handled
	// separately via the RecoveryTest callback, not via regular HTTP requests.
	state, reason := t.manager.State()
	if state == StateInvalid || state == StateRecovering {
		return nil, &AuthInvalidError{
			Reason: reason,
			State:  state,
		}
	}

	// Step 2: Execute the request using the base transport
	resp, err := t.base.RoundTrip(req)
	if err != nil {
		// Check if the error is a credential-related failure.
		// AWS SSO and other exec credential providers fail during RoundTrip
		// before an HTTP request is even made, returning an error rather than
		// an HTTP 401 response.
		if isCredentialError(err) {
			t.manager.ReportFailure(err.Error())
			return nil, &AuthInvalidError{
				Reason: err.Error(),
				State:  StateInvalid,
			}
		}
		// Other network/transport errors - pass through
		return nil, err
	}

	// Step 3: Check for 401 Unauthorized - report auth failure
	if resp.StatusCode == http.StatusUnauthorized {
		// Report the failure to the manager
		t.manager.ReportFailure("401 Unauthorized")

		// Close the response body to prevent resource leaks
		resp.Body.Close()

		// Return an AuthInvalidError
		return nil, &AuthInvalidError{
			Reason: "401 Unauthorized",
			State:  StateInvalid,
		}
	}

	// Step 4: Check for successful responses (2xx/3xx) - report auth success
	if resp.StatusCode >= 200 && resp.StatusCode < 400 {
		t.manager.ReportSuccess()
	}

	// Step 5: Return the response (including 4xx/5xx errors other than 401)
	return resp, nil
}

// isCredentialError checks if an error indicates a credential/auth failure.
// This catches exec credential provider failures (like AWS SSO) that happen
// before an HTTP request is made.
func isCredentialError(err error) bool {
	if err == nil {
		return false
	}
	errStr := strings.ToLower(err.Error())
	// Patterns that indicate credential/auth failures from exec providers
	credentialPatterns := []string{
		"getting credentials",
		"exec: executable",
		"failed with exit code",
		"token has expired",
		"token is expired",
		"sso session",
		"refresh token",
		"authentication required",
		"unauthorized",
		"access denied",
		"permission denied",
	}
	for _, pattern := range credentialPatterns {
		if strings.Contains(errStr, pattern) {
			return true
		}
	}
	return false
}
