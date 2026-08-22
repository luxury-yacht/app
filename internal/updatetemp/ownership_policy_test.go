package updatetemp

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestWindowsOwnerSIDRequiresExactCurrentUser(t *testing.T) {
	const (
		tokenUserSID         = "S-1-5-21-1000"
		tokenDefaultOwnerSID = "S-1-5-32-544"
		foreignOwnerSID      = "S-1-5-21-2000"
	)

	require.NotEqual(t, tokenUserSID, tokenDefaultOwnerSID)
	require.False(t, ownerSIDIsCurrentUser(tokenDefaultOwnerSID, tokenUserSID))
	require.True(t, ownerSIDIsCurrentUser(tokenUserSID, tokenUserSID))
	require.False(t, ownerSIDIsCurrentUser(foreignOwnerSID, tokenUserSID))
}
