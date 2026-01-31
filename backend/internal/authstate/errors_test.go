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

func TestStateString(t *testing.T) {
	tests := []struct {
		state    State
		expected string
	}{
		{StateValid, "valid"},
		{StateInvalid, "invalid"},
		{StateRecovering, "recovering"},
		{State(99), "unknown"}, // Test unknown state
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			require.Equal(t, tt.expected, tt.state.String())
		})
	}
}

func TestAuthInvalidErrorWithState(t *testing.T) {
	// Verify the State field is properly stored
	err := &AuthInvalidError{
		Reason: "SSO token expired",
		State:  StateInvalid,
	}
	require.Equal(t, StateInvalid, err.State)
	require.Equal(t, "auth invalid: SSO token expired", err.Error())
}
