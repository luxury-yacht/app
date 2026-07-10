package backend

import (
	"encoding/json"
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
	biomeConfigJSON, err := os.ReadFile("../frontend/biome.json")
	require.NoError(t, err)

	var biomeConfig struct {
		Files struct {
			Includes []string `json:"includes"`
		} `json:"files"`
	}
	require.NoError(t, json.Unmarshal(biomeConfigJSON, &biomeConfig))
	require.Contains(t, biomeConfig.Files.Includes, "!!src/core/refresh/types.generated.ts")

	gitAttributes, err := os.ReadFile("../.gitattributes")
	require.NoError(t, err)
	require.True(t,
		strings.Contains(string(gitAttributes), "* text=auto eol=lf"),
		"generated refresh contract must retain LF line endings",
	)
}
