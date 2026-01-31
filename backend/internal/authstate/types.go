// Package authstate provides centralized authentication state management.
// It tracks authentication validity and provides error types for handling
// authentication failures across the application.
package authstate

// State represents the current authentication state.
type State int

const (
	// StateValid indicates authentication is valid and requests can proceed.
	StateValid State = iota
	// StateInvalid indicates authentication has failed (e.g., token expired).
	StateInvalid
	// StateRecovering indicates authentication recovery is in progress.
	StateRecovering
)

// String returns a human-readable representation of the auth state.
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
