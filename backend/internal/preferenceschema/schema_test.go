package preferenceschema

import (
	"encoding/json"
	"slices"
	"testing"

	"github.com/stretchr/testify/require"
)

// Every row is self-consistent: package backend, the generated frontend
// contract, and the parity vectors all trust these invariants.
func TestEveryPreferenceIsWellFormed(t *testing.T) {
	seen := map[string]bool{}
	for _, p := range All() {
		t.Run(p.Key, func(t *testing.T) {
			require.NotEmpty(t, p.Key)
			require.False(t, seen[p.Key], "duplicate key")
			seen[p.Key] = true
			switch p.Type {
			case Boolean:
				require.IsType(t, false, p.Default)
			case Integer:
				requireWellFormedInteger(t, p)
			case Enum:
				require.IsType(t, "", p.Default)
				require.NotEmpty(t, p.Label)
				require.Contains(t, p.Options, p.Default)
			case Color:
				require.Equal(t, "", p.Default)
				require.Equal(t, ValidationHexColorOrEmpty, p.Validation)
			case String:
				require.IsType(t, "", p.Default)
				require.NotEmpty(t, p.Default, "an empty string means the default")
			default:
				t.Fatalf("unknown type %q", p.Type)
			}
			if p.Type != Enum {
				require.Empty(t, p.Options)
			}
			if p.Type != Integer {
				require.Empty(t, p.IntOptions)
				require.Empty(t, p.NonPositive)
				require.Nil(t, p.Min)
				require.Nil(t, p.Max)
			}
		})
	}
}

func requireWellFormedInteger(t *testing.T, p Preference) {
	t.Helper()
	def, ok := p.Default.(int)
	require.True(t, ok, "integer default must be an int")
	if len(p.IntOptions) > 0 {
		require.Nil(t, p.Min, "an option list has no bounds")
		require.Nil(t, p.Max, "an option list has no bounds")
		require.Empty(t, p.NonPositive, "an option list has no non-positive rule")
		require.True(t, slices.IsSorted(p.IntOptions))
		require.Contains(t, p.IntOptions, def)
		return
	}
	require.NotNil(t, p.Min)
	require.Contains(t, []NonPositive{NonPositiveDefault, NonPositiveClamp}, p.NonPositive)
	if p.NonPositive == NonPositiveDefault {
		require.GreaterOrEqual(t, *p.Min, 1, "the default rule needs a positive minimum")
	}
	require.GreaterOrEqual(t, def, *p.Min)
	if p.Max != nil {
		require.LessOrEqual(t, def, *p.Max)
	}
}

func TestLookupFindsEveryKeyAndNothingElse(t *testing.T) {
	for _, p := range All() {
		found, ok := Lookup(p.Key)
		require.True(t, ok)
		require.Equal(t, p.Key, found.Key)
	}
	_, ok := Lookup("maxTableRows")
	require.False(t, ok)
	require.Panics(t, func() { MustLookup("maxTableRows") })
}

// Validate is the write path (UpdateAppPreferences, import): it rejects what
// the user could not have meant and settles every integer. Repair is the read
// path (settings.json): whatever Validate rejects becomes the default.
func TestValidateAndRepair(t *testing.T) {
	cases := []struct {
		name    string
		key     string
		raw     any
		want    any
		invalid bool
	}{
		// Range integers with the default rule: the raw number decides, before
		// truncation, whether it means "use the default".
		{"positive fraction below 1 truncates then clamps", KeyKubernetesClientQPS, 0.9, 1, false},
		{"zero is the default", KeyKubernetesClientQPS, 0, DefaultKubernetesClientQPS, false},
		{"negative fraction is the default", KeyKubernetesClientQPS, -0.1, DefaultKubernetesClientQPS, false},
		{"above max clamps", KeyKubernetesClientQPS, 999_999, MaxKubernetesClientQPS, false},
		{"in range keeps", KeyKubernetesClientQPS, 250, 250, false},
		{"fraction above min truncates", KeyObjectPanelDockedRightWidth, 500.5, 500, false},
		{"below min clamps", KeyObjectPanelDockedRightWidth, 100, MinObjectPanelDockedRightWidth, false},
		{"json number", KeyKubernetesClientBurst, json.Number("42"), 42, false},
		// Range integers with the clamp rule: zero and negatives are values.
		{"negative fraction truncates toward zero", KeyPaletteBrightnessLight, -0.5, 0, false},
		{"larger negative fraction truncates toward zero", KeyPaletteBrightnessLight, -10.7, -10, false},
		{"below min clamps (clamp rule)", KeyPaletteBrightnessLight, -80, MinPaletteBrightness, false},
		{"zero is a value", KeyPaletteHueLight, 0, 0, false},
		// Option-list integers match exactly, with no truncation.
		{"listed size keeps", KeyDefaultTablePageSize, 250, 250, false},
		{"fraction next to an option is off-list", KeyDefaultTablePageSize, 25.5, DefaultTablePageSize, false},
		{"fraction above an option is off-list", KeyDefaultTablePageSize, 100.5, DefaultTablePageSize, false},
		{"unlisted size is off-list", KeyDefaultTablePageSize, 37, DefaultTablePageSize, false},
		{"zero size is off-list", KeyDefaultTablePageSize, 0, DefaultTablePageSize, false},
		// Strings.
		{"known enum keeps", KeyAppearanceMode, "dark", "dark", false},
		{"unknown enum", KeyAppearanceMode, "sepia", "system", true},
		{"empty color is the default color", KeyAccentColorLight, "", "", false},
		{"hex color keeps", KeyAccentColorLight, "#a1B2c3", "#a1B2c3", false},
		{"malformed color", KeyAccentColorLight, "#zzz", "", true},
		{"empty format is the default", KeyObjPanelLogsAPITimestampFormat, "", DefaultObjPanelLogsAPITimestampFormat, false},
		{"any non-empty format keeps", KeyObjPanelLogsAPITimestampFormat, "HH:mm", "HH:mm", false},
		// Wrong types.
		{"string for integer", KeyKubernetesClientQPS, "250", DefaultKubernetesClientQPS, true},
		{"number for boolean", KeyAutoRefreshEnabled, 1, true, true},
		{"number for enum", KeyAppearanceMode, 1, "system", true},
		{"nil", KeyDimInactiveNamespaces, nil, true, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := MustLookup(tc.key)
			got, err := p.Validate(tc.raw)
			if tc.invalid {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
				require.Equal(t, tc.want, got)
			}
			require.Equal(t, tc.want, p.Repair(tc.raw))
		})
	}
}

// Error text names the setting so a rejected import or update says what was
// wrong; the enum wording is what the Settings import surfaces today.
func TestValidateErrorsNameTheSetting(t *testing.T) {
	_, err := MustLookup(KeyAppearanceMode).Validate("sepia")
	require.ErrorContains(t, err, "invalid appearance mode: sepia")
	_, err = MustLookup(KeyAccentColorLight).Validate("#zzz")
	require.ErrorContains(t, err, "invalid color format for accentColorLight")
	_, err = MustLookup(KeyKubernetesClientQPS).Validate("x")
	require.ErrorContains(t, err, "kubernetesClientQPS: expected integer value")
}
