package genpreferences

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/luxury-yacht/app/backend/internal/preferenceschema"
	"github.com/stretchr/testify/require"
)

// The frontend store notifies subscribers in key order, so the contract lists
// keys in schema declaration order (a JSON map would sort them).
func TestRenderListsEveryKeyInDeclarationOrder(t *testing.T) {
	generated, err := Render()
	require.NoError(t, err)
	contract := string(generated)

	keysStart := strings.Index(contract, "export const APP_PREFERENCE_KEYS = [")
	require.GreaterOrEqual(t, keysStart, 0)
	keysBlock := contract[keysStart:]
	keysBlock = keysBlock[:strings.Index(keysBlock, "]")]
	last := -1
	for _, spec := range preferenceschema.All() {
		position := strings.Index(keysBlock, `"`+spec.Key+`"`)
		require.Greater(t, position, last, "%s out of order", spec.Key)
		last = position
		require.Contains(t, contract, "\n  "+spec.Key+": {", "spec row for %s", spec.Key)
	}
}

// Narrow value types are what make the frontend's fallbacks and option lists
// impossible to drift: a removed enum option or page size fails typecheck.
func TestRenderTypesEachPreferenceFromItsSpec(t *testing.T) {
	generated, err := Render()
	require.NoError(t, err)
	contract := string(generated)

	for _, expected := range []string{
		"  appearanceMode: 'light' | 'dark' | 'system';",
		"  gridTablePersistenceMode: 'shared' | 'namespaced';",
		"  defaultObjectPanelPosition: 'right' | 'bottom' | 'floating';",
		"  defaultTablePageSize: 25 | 50 | 100 | 250 | 500 | 1000;",
		"  kubernetesClientQPS: number;",
		"  autoRefreshEnabled: boolean;",
		"  accentColorLight: string;",
		"  objPanelLogsApiTimestampFormat: string;",
		"export const ZOOM_LEVEL = {",
		"export const HEX_COLOR_PATTERN = ",
	} {
		require.Contains(t, contract, expected)
	}
}

func TestRenderParityVectorsRepairEveryRuleBoundary(t *testing.T) {
	generated, err := RenderParityVectors()
	require.NoError(t, err)
	var file struct {
		Vectors []struct {
			Key      string `json:"key"`
			Input    any    `json:"input"`
			Repaired any    `json:"repaired"`
		} `json:"vectors"`
	}
	require.NoError(t, json.Unmarshal(generated, &file))

	repaired := map[string]map[string]any{}
	for _, vector := range file.Vectors {
		if repaired[vector.Key] == nil {
			repaired[vector.Key] = map[string]any{}
		}
		encoded, err := json.Marshal(vector.Input)
		require.NoError(t, err)
		repaired[vector.Key][string(encoded)] = vector.Repaired
	}

	for _, spec := range preferenceschema.All() {
		require.NotEmpty(t, repaired[spec.Key], "vectors for %s", spec.Key)
		require.Contains(t, repaired[spec.Key], "null", "%s repairs a missing value", spec.Key)
	}
	qps := repaired[preferenceschema.KeyKubernetesClientQPS]
	require.EqualValues(t, 1, qps["0.9"], "a positive fraction truncates then clamps")
	require.EqualValues(t, preferenceschema.DefaultKubernetesClientQPS, qps["-0.5"], "a non-positive value is the default")
	require.EqualValues(t, preferenceschema.DefaultKubernetesClientQPS, qps[`"x"`], "a wrong type is the default")
	pageSize := repaired[preferenceschema.KeyDefaultTablePageSize]
	require.EqualValues(t, preferenceschema.DefaultTablePageSize, pageSize["25.5"], "option lists match exactly")
	require.EqualValues(t, preferenceschema.DefaultTablePageSize, pageSize["100.5"])
	require.EqualValues(t, 250, pageSize["250"])
	brightness := repaired[preferenceschema.KeyPaletteBrightnessLight]
	require.EqualValues(t, 0, brightness["-0.5"], "a clamp-rule fraction truncates toward zero")
	require.EqualValues(t, -10, brightness["-10.7"])
	require.Equal(t, "system", repaired[preferenceschema.KeyAppearanceMode][`"unknown-option"`])
	require.Equal(t, "", repaired[preferenceschema.KeyAccentColorLight][`"#zzz"`])

	// The frontend's stricter Day.js check is a deliberate difference, so the
	// format key carries only the cases both sides settle the same way.
	format := repaired[preferenceschema.KeyObjPanelLogsAPITimestampFormat]
	require.ElementsMatch(t, []string{"null", `""`, "7", `"` + preferenceschema.DefaultObjPanelLogsAPITimestampFormat + `"`}, keysOf(format))
}

func keysOf(values map[string]any) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	return keys
}
