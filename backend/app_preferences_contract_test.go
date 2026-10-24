/*
 * backend/app_preferences_contract_test.go
 *
 * Verifies the generated frontend app-preference contract and its parity
 * vectors are current with the preference schema.
 */

package backend

import (
	"os"
	"testing"

	"github.com/luxury-yacht/app/backend/internal/genpreferences"
	"github.com/stretchr/testify/require"
)

func TestGeneratedAppPreferencesContractIsCurrent(t *testing.T) {
	want, err := genpreferences.Render()
	require.NoError(t, err)
	got, err := os.ReadFile("../frontend/src/core/settings/appPreferences.generated.ts")
	require.NoError(t, err, "generated app-preference contract is missing; run `go generate ./backend`")
	require.Equal(t, string(want), string(got), "generated app-preference contract is stale; run `go generate ./backend`")
}

func TestGeneratedAppPreferenceParityVectorsAreCurrent(t *testing.T) {
	want, err := genpreferences.RenderParityVectors()
	require.NoError(t, err)
	got, err := os.ReadFile("../frontend/src/core/settings/appPreferences.parity.generated.json")
	require.NoError(t, err, "generated parity vectors are missing; run `go generate ./backend`")
	require.Equal(t, string(want), string(got), "generated parity vectors are stale; run `go generate ./backend`")
}
