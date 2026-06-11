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

// ErrorClass classifies the failure of a recovery probe. The recovery loop
// only spends its bounded attempt budget on auth-class failures; connectivity
// failures keep the manager probing, because an unreachable cluster says
// nothing about whether the credentials are valid.
type ErrorClass string

const (
	// ErrorClassUnknown means no probe has produced a verdict yet.
	ErrorClassUnknown ErrorClass = ""
	// ErrorClassAuth means a probe reached the cluster and authentication
	// was rejected, or the credential plugin itself failed.
	ErrorClassAuth ErrorClass = "auth"
	// ErrorClassConnectivity means a probe could not reach the cluster.
	ErrorClassConnectivity ErrorClass = "connectivity"
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
