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
	prettierIgnore, err := os.ReadFile("../frontend/.prettierignore")
	require.NoError(t, err)
	require.Contains(t, string(prettierIgnore), "src/core/refresh/types.generated.ts")

	gitAttributes, err := os.ReadFile("../.gitattributes")
	require.NoError(t, err)
	require.True(t,
		strings.Contains(string(gitAttributes), "frontend/src/core/refresh/types.generated.ts text eol=lf"),
		"generated refresh contract must retain LF line endings",
	)
}
