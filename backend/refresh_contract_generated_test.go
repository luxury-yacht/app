package backend

import (
	"os"
	"strings"
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

func TestRefreshTypeScriptContractHasSingleFormattingOwner(t *testing.T) {
	biomeConfigJSONC, err := os.ReadFile("../frontend/biome.jsonc")
	require.NoError(t, err)
	require.Equal(t, 3, strings.Count(string(biomeConfigJSONC), "!src/core/refresh/types.generated.ts"),
		"generated refresh contracts must be excluded from Biome formatting, assist, and linting")

	gitAttributes, err := os.ReadFile("../.gitattributes")
	require.NoError(t, err)
	require.True(t,
		strings.Contains(string(gitAttributes), "* text=auto eol=lf"),
		"generated refresh contract must retain LF line endings",
	)
}
