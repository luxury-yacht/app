package backend

import (
	"os"
	"testing"

	"github.com/luxury-yacht/app/backend/internal/genrefreshcontracts"
	"github.com/stretchr/testify/require"
)

func TestRefreshTypeScriptContractGeneratedInSync(t *testing.T) {
	want, err := genrefreshcontracts.Render()
	require.NoError(t, err)

	got, err := os.ReadFile("../frontend/src/core/refresh/types.generated.ts")
	require.NoError(t, err, "generated refresh contract is missing; run `go generate ./backend`")
	require.Equal(t, string(want), string(got), "generated refresh contract is stale; run `go generate ./backend`")
}
