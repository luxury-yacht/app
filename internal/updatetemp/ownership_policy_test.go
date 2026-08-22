package updatetemp

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestWindowsOwnerSIDAllowsOnlyTrustedOwnershipMigration(t *testing.T) {
	const (
		tokenUserSID         = "S-1-5-21-1000"
		tokenDefaultOwnerSID = "S-1-5-32-544"
		foreignOwnerSID      = "S-1-5-21-2000"
	)

	require.NotEqual(t, tokenUserSID, tokenDefaultOwnerSID)
	require.True(t, ownerSIDCanBeMigrated(tokenDefaultOwnerSID, tokenUserSID, tokenDefaultOwnerSID))
	require.True(t, ownerSIDCanBeMigrated(tokenUserSID, tokenUserSID, tokenDefaultOwnerSID))
	require.False(t, ownerSIDCanBeMigrated(foreignOwnerSID, tokenUserSID, tokenDefaultOwnerSID))
}
