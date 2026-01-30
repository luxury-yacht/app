package authstate

import "fmt"

// AuthInvalidError represents an authentication failure.
// It implements the error interface and supports errors.Is() for type checking.
type AuthInvalidError struct {
	// Reason describes why authentication is invalid (e.g., "token expired", "401 Unauthorized").
	Reason string
	// State indicates the current authentication state when this error was created.
	State State
}

// Error returns a human-readable error message.
func (e *AuthInvalidError) Error() string {
	return fmt.Sprintf("auth invalid: %s", e.Reason)
}

// Is implements the interface for errors.Is() to allow type-based error matching.
// This enables code to check if any error in a chain is an AuthInvalidError.
func (e *AuthInvalidError) Is(target error) bool {
	_, ok := target.(*AuthInvalidError)
	return ok
}
