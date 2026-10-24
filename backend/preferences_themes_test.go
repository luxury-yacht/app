package backend

import (
	"encoding/json"
	"errors"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/internal/preferenceschema"
)

// TestGetThemes_Default verifies that GetThemes always returns the protected
// default theme.
func TestGetThemes_Default(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	themes, err := app.Preferences.GetThemes()
	require.NoError(t, err)
	require.Len(t, themes, 1)
	assert.Equal(t, "default", themes[0].ID)
	assert.Equal(t, "default", themes[0].Name)
	assert.Empty(t, themes[0].ClusterPattern)
}

// TestLoadSettingsFileSeedsDefaultThemeFromActivePreferences verifies that
// upgrades from settings files without a saved default theme preserve the
// user's active appearance values as the new fallback theme.
func TestLoadSettingsFileSeedsDefaultThemeFromActivePreferences(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	configPath, err := app.Preferences.getSettingsFilePath()
	require.NoError(t, err)
	writeTestFileWithParents(t, configPath, []byte(`{
		"schemaVersion": 1,
		"preferences": {
			"appearanceMode": "dark",
			"paletteHueLight": 18,
			"paletteSaturationLight": 22,
			"paletteBrightnessLight": 4,
			"paletteHueDark": 210,
			"paletteSaturationDark": 35,
			"paletteBrightnessDark": -7,
			"accentColorLight": "#123456",
			"accentColorDark": "#abcdef",
			"linkColorLight": "#654321",
			"linkColorDark": "#fedcba"
		}
	}`), 0o644)

	themes, err := app.Preferences.GetThemes()
	require.NoError(t, err)
	require.Len(t, themes, 1)
	defaultTheme := themes[0]
	assert.Equal(t, "default", defaultTheme.ID)
	assert.Equal(t, 18, defaultTheme.PaletteHueLight)
	assert.Equal(t, 22, defaultTheme.PaletteSaturationLight)
	assert.Equal(t, 4, defaultTheme.PaletteBrightnessLight)
	assert.Equal(t, 210, defaultTheme.PaletteHueDark)
	assert.Equal(t, 35, defaultTheme.PaletteSaturationDark)
	assert.Equal(t, -7, defaultTheme.PaletteBrightnessDark)
	assert.Equal(t, "#123456", defaultTheme.AccentColorLight)
	assert.Equal(t, "#abcdef", defaultTheme.AccentColorDark)
	assert.Equal(t, "#654321", defaultTheme.LinkColorLight)
	assert.Equal(t, "#fedcba", defaultTheme.LinkColorDark)

	require.NoError(t, app.Preferences.ApplyTheme("default"))
	settings, err := app.Preferences.loadSettingsFile()
	require.NoError(t, err)
	assert.Equal(t, 18, settings.Preferences.PaletteHueLight)
	assert.Equal(t, 210, settings.Preferences.PaletteHueDark)
	assert.Equal(t, "#123456", settings.Preferences.AccentColorLight)
	assert.Equal(t, "#abcdef", settings.Preferences.AccentColorDark)
}

// TestSaveTheme_Create verifies that saving a theme with a new ID appends it
// to the theme list.
func TestSaveTheme_Create(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	theme := Theme{
		ID:              "t-1",
		Name:            "Danger Red",
		ClusterPattern:  "prod*",
		PaletteHueLight: 0,
	}

	require.NoError(t, app.Preferences.SaveTheme(theme))

	themes, err := app.Preferences.GetThemes()
	require.NoError(t, err)
	require.Len(t, themes, 2)
	assert.Equal(t, "t-1", themes[0].ID)
	assert.Equal(t, "Danger Red", themes[0].Name)
	assert.Equal(t, "prod*", themes[0].ClusterPattern)
	assert.Equal(t, "default", themes[1].ID)
}

// TestSaveTheme_Update verifies that saving a theme with an existing ID
// updates it in place without changing the list length.
func TestSaveTheme_Update(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	// Create two themes.
	require.NoError(t, app.Preferences.SaveTheme(Theme{ID: "t-1", Name: "Red"}))
	require.NoError(t, app.Preferences.SaveTheme(Theme{ID: "t-2", Name: "Blue"}))

	// Update the first theme.
	require.NoError(t, app.Preferences.SaveTheme(Theme{ID: "t-1", Name: "Updated Red", ClusterPattern: "staging*"}))

	themes, err := app.Preferences.GetThemes()
	require.NoError(t, err)
	require.Len(t, themes, 3)
	// Order is preserved; the first theme should be the updated one.
	assert.Equal(t, "t-1", themes[0].ID)
	assert.Equal(t, "Updated Red", themes[0].Name)
	assert.Equal(t, "staging*", themes[0].ClusterPattern)
	// Second theme unchanged.
	assert.Equal(t, "t-2", themes[1].ID)
	assert.Equal(t, "Blue", themes[1].Name)
	assert.Equal(t, "default", themes[2].ID)
}

// TestSaveTheme_Validation verifies that SaveTheme rejects themes without
// required fields.
func TestSaveTheme_Validation(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	// Missing ID.
	err := app.Preferences.SaveTheme(Theme{Name: "No ID"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "theme ID is required")

	// Missing name.
	err = app.Preferences.SaveTheme(Theme{ID: "t-1"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "theme name is required")

	// Invalid cluster pattern.
	err = app.Preferences.SaveTheme(Theme{ID: "t-1", Name: "Bad Pattern", ClusterPattern: "prod-["})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid cluster pattern")
	assert.Contains(t, err.Error(), "missing closing bracket")
}

func TestAppValidateThemeClusterPattern(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	result := app.Preferences.ValidateThemeClusterPattern("prod-[a-z]*")
	require.True(t, result.Valid)
	assert.Empty(t, result.Message)

	result = app.Preferences.ValidateThemeClusterPattern("prod-[")
	require.False(t, result.Valid)
	assert.Equal(t, "Invalid cluster pattern: missing closing bracket.", result.Message)

	result = app.Preferences.ValidateThemeClusterPattern(`prod-\`)
	require.False(t, result.Valid)
	assert.Equal(t, "Invalid cluster pattern: trailing escape.", result.Message)
}

// TestSaveTheme_DefaultProtectedFields verifies that the default theme can
// store palette values but cannot be renamed or assigned a pattern.
func TestSaveTheme_DefaultProtectedFields(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	require.NoError(t, app.Preferences.SaveTheme(Theme{
		ID:                     "default",
		ClusterPattern:         "prod-*",
		PaletteHueLight:        25,
		PaletteSaturationLight: 50,
		PaletteBrightnessLight: 10,
	}))

	themes, err := app.Preferences.GetThemes()
	require.NoError(t, err)
	require.Len(t, themes, 1)
	assert.Equal(t, "default", themes[0].ID)
	assert.Equal(t, "default", themes[0].Name)
	assert.Empty(t, themes[0].ClusterPattern)
	assert.Equal(t, 25, themes[0].PaletteHueLight)
	assert.Equal(t, 50, themes[0].PaletteSaturationLight)
	assert.Equal(t, 10, themes[0].PaletteBrightnessLight)
}

// TestDeleteTheme verifies that DeleteTheme removes a theme by ID.
func TestDeleteTheme(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	// Seed two themes.
	require.NoError(t, app.Preferences.SaveTheme(Theme{ID: "t-1", Name: "Red"}))
	require.NoError(t, app.Preferences.SaveTheme(Theme{ID: "t-2", Name: "Blue"}))

	// Delete the first.
	require.NoError(t, app.Preferences.DeleteTheme("t-1"))

	themes, err := app.Preferences.GetThemes()
	require.NoError(t, err)
	require.Len(t, themes, 2)
	assert.Equal(t, "t-2", themes[0].ID)
	assert.Equal(t, "default", themes[1].ID)
}

// TestDeleteTheme_NotFound verifies that deleting a non-existent theme ID
// returns an error.
func TestDeleteTheme_NotFound(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	err := app.Preferences.DeleteTheme("non-existent")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "theme not found: non-existent")
}

// TestDeleteTheme_DefaultProtected verifies that the default theme cannot be
// deleted.
func TestDeleteTheme_DefaultProtected(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	err := app.Preferences.DeleteTheme("default")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "default theme cannot be deleted")
}

// TestReorderThemes verifies that ReorderThemes rearranges themes according to
// the supplied ID list.
func TestReorderThemes(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	// Seed three themes in order.
	require.NoError(t, app.Preferences.SaveTheme(Theme{ID: "t-1", Name: "Red"}))
	require.NoError(t, app.Preferences.SaveTheme(Theme{ID: "t-2", Name: "Blue"}))
	require.NoError(t, app.Preferences.SaveTheme(Theme{ID: "t-3", Name: "Green"}))

	// Reorder: reverse the list.
	require.NoError(t, app.Preferences.ReorderThemes([]string{"t-3", "t-2", "t-1", "default"}))

	themes, err := app.Preferences.GetThemes()
	require.NoError(t, err)
	require.Len(t, themes, 4)
	assert.Equal(t, "t-3", themes[0].ID)
	assert.Equal(t, "t-2", themes[1].ID)
	assert.Equal(t, "t-1", themes[2].ID)
	assert.Equal(t, "default", themes[3].ID)
	// Verify full theme data survived the reorder.
	assert.Equal(t, "Green", themes[0].Name)
	assert.Equal(t, "Blue", themes[1].Name)
	assert.Equal(t, "Red", themes[2].Name)
}

// TestReorderThemes_InvalidIDs verifies that ReorderThemes returns errors for
// mismatched ID lists.
func TestReorderThemes_InvalidIDs(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	require.NoError(t, app.Preferences.SaveTheme(Theme{ID: "t-1", Name: "Red"}))
	require.NoError(t, app.Preferences.SaveTheme(Theme{ID: "t-2", Name: "Blue"}))

	// Wrong count (too few IDs).
	err := app.Preferences.ReorderThemes([]string{"t-1", "default"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "id count mismatch")

	// Wrong count (too many IDs).
	err = app.Preferences.ReorderThemes([]string{"t-1", "t-2", "t-3", "default"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "id count mismatch")

	// Correct count but unknown ID.
	err = app.Preferences.ReorderThemes([]string{"t-1", "unknown", "default"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unknown theme ID: unknown")

	// Correct IDs but default moved away from the bottom.
	err = app.Preferences.ReorderThemes([]string{"default", "t-2", "t-1"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "default theme must remain last")
}

// activeAppearance is the palette, accent, and link part of the active settings.
type activeAppearance struct {
	HueLight, SaturationLight, BrightnessLight   int
	HueDark, SaturationDark, BrightnessDark      int
	AccentLight, AccentDark, LinkLight, LinkDark string
}

func cachedAppearance(t *testing.T, preferences *PreferencesService) activeAppearance {
	t.Helper()
	settings, err := preferences.GetAppSettings()
	require.NoError(t, err)
	return activeAppearance{
		settings.PaletteHueLight, settings.PaletteSaturationLight, settings.PaletteBrightnessLight,
		settings.PaletteHueDark, settings.PaletteSaturationDark, settings.PaletteBrightnessDark,
		settings.AccentColorLight, settings.AccentColorDark, settings.LinkColorLight, settings.LinkColorDark,
	}
}

func savedAppearance(t *testing.T, preferences *PreferencesService) activeAppearance {
	t.Helper()
	path, err := preferences.getSettingsFilePath()
	require.NoError(t, err)
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	var file settingsFile
	require.NoError(t, json.Unmarshal(data, &file))
	saved := file.Preferences
	return activeAppearance{
		saved.PaletteHueLight, saved.PaletteSaturationLight, saved.PaletteBrightnessLight,
		saved.PaletteHueDark, saved.PaletteSaturationDark, saved.PaletteBrightnessDark,
		saved.AccentColorLight, saved.AccentColorDark, saved.LinkColorLight, saved.LinkColorDark,
	}
}

// A theme can hold values outside the preference bounds (SaveTheme checks only
// its identity and pattern). Applying it stores the repaired values, and the
// cache that later saves write from holds the same values.
func TestApplyThemeStoresRepairedValuesInCacheAndFile(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)
	ensurePreferencesLoaded(t, app.Preferences)
	require.NoError(t, app.Preferences.SaveTheme(Theme{
		ID: "loud", Name: "Loud",
		PaletteHueLight: 999, PaletteSaturationLight: 150, PaletteBrightnessLight: -80,
		AccentColorLight: "#zzz",
	}))

	require.NoError(t, app.Preferences.ApplyTheme("loud"))

	want := activeAppearance{HueLight: 360, SaturationLight: 100, BrightnessLight: -50}
	require.Equal(t, want, savedAppearance(t, app.Preferences))
	require.Equal(t, want, cachedAppearance(t, app.Preferences))

	// An unrelated save writes the whole cache back to the file.
	require.NoError(t, updatePreference(app.Preferences, preferenceschema.KeyUseShortResourceNames, true))
	require.Equal(t, want, savedAppearance(t, app.Preferences))
	require.Equal(t, want, cachedAppearance(t, app.Preferences))
}

// A failed save leaves the active values where they were, in the cache and on
// disk; the same apply succeeds once the file can be written.
func TestApplyThemeFailedSaveLeavesActiveValues(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)
	preferences := app.Preferences
	require.NoError(t, updatePreferences(preferences,
		AppPreferenceChange{Key: preferenceschema.KeyPaletteHueLight, Value: 10},
		AppPreferenceChange{Key: preferenceschema.KeyPaletteSaturationLight, Value: 20},
		AppPreferenceChange{Key: preferenceschema.KeyPaletteBrightnessLight, Value: 5},
		AppPreferenceChange{Key: preferenceschema.KeyAccentColorLight, Value: "#112233"},
		AppPreferenceChange{Key: preferenceschema.KeyLinkColorLight, Value: "#445566"},
	))
	require.NoError(t, preferences.SaveTheme(Theme{
		ID: "ocean", Name: "Ocean",
		PaletteHueLight: 210, PaletteSaturationLight: 80, PaletteBrightnessLight: -15,
		AccentColorLight: "#0077cc", LinkColorLight: "#3399ff",
	}))
	ensurePreferencesLoaded(t, preferences)
	seeded := activeAppearance{
		HueLight: 10, SaturationLight: 20, BrightnessLight: 5,
		AccentLight: "#112233", LinkLight: "#445566",
	}
	require.Equal(t, seeded, cachedAppearance(t, preferences))
	path, err := preferences.getSettingsFilePath()
	require.NoError(t, err)
	diskBefore, err := os.ReadFile(path)
	require.NoError(t, err)

	originalWrite := writeSettingsFileAtomic
	t.Cleanup(func() { writeSettingsFileAtomic = originalWrite })
	failure := errors.New("forced theme write failure")
	writeSettingsFileAtomic = func(string, []byte, os.FileMode) error { return failure }
	require.ErrorIs(t, preferences.ApplyTheme("ocean"), failure)
	require.Equal(t, seeded, cachedAppearance(t, preferences))
	diskAfter, err := os.ReadFile(path)
	require.NoError(t, err)
	require.Equal(t, diskBefore, diskAfter)

	writeSettingsFileAtomic = originalWrite
	require.NoError(t, preferences.ApplyTheme("ocean"))
	applied := activeAppearance{
		HueLight: 210, SaturationLight: 80, BrightnessLight: -15,
		AccentLight: "#0077cc", LinkLight: "#3399ff",
	}
	require.Equal(t, applied, savedAppearance(t, preferences))
	require.Equal(t, applied, cachedAppearance(t, preferences))
}

// TestApplyTheme verifies that ApplyTheme copies a saved theme's palette values
// into the active settings fields, on disk and in the loaded cache.
func TestApplyTheme(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)
	// Load first: ApplyTheme updates only a cache that exists, and a read after
	// an unloaded apply would load the file and hide a stale cache.
	ensurePreferencesLoaded(t, app.Preferences)

	// Save a theme with specific palette values.
	theme := Theme{
		ID:                     "t-apply",
		Name:                   "Ocean Blue",
		ClusterPattern:         "prod*",
		PaletteHueLight:        210,
		PaletteSaturationLight: 80,
		PaletteBrightnessLight: 10,
		PaletteHueDark:         220,
		PaletteSaturationDark:  70,
		PaletteBrightnessDark:  -15,
		AccentColorLight:       "#0077cc",
		AccentColorDark:        "#3399ff",
	}
	require.NoError(t, app.Preferences.SaveTheme(theme))

	// Apply the theme.
	require.NoError(t, app.Preferences.ApplyTheme("t-apply"))

	// Verify the active palette fields in settings match the theme's values.
	settings, err := app.Preferences.loadSettingsFile()
	require.NoError(t, err)
	assert.Equal(t, 210, settings.Preferences.PaletteHueLight)
	assert.Equal(t, 80, settings.Preferences.PaletteSaturationLight)
	assert.Equal(t, 10, settings.Preferences.PaletteBrightnessLight)
	assert.Equal(t, 220, settings.Preferences.PaletteHueDark)
	assert.Equal(t, 70, settings.Preferences.PaletteSaturationDark)
	assert.Equal(t, -15, settings.Preferences.PaletteBrightnessDark)
	assert.Equal(t, "#0077cc", settings.Preferences.AccentColorLight)
	assert.Equal(t, "#3399ff", settings.Preferences.AccentColorDark)
	assert.Equal(t, savedAppearance(t, app.Preferences), cachedAppearance(t, app.Preferences))
}

// TestApplyTheme_NotFound verifies that ApplyTheme returns an error when the
// requested theme ID does not exist.
func TestApplyTheme_NotFound(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	err := app.Preferences.ApplyTheme("non-existent")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "theme not found: non-existent")
}

// TestMatchThemeForCluster_Match verifies that MatchThemeForCluster returns the
// correct theme when a pattern matches the given context name.
func TestMatchThemeForCluster_Match(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	// Save themes with patterns.
	require.NoError(t, app.Preferences.SaveTheme(Theme{ID: "t-dev", Name: "Dev Green", ClusterPattern: "dev-*"}))
	require.NoError(t, app.Preferences.SaveTheme(Theme{ID: "t-prod", Name: "Prod Red", ClusterPattern: "prod-*"}))

	// Match a dev context.
	matched, err := app.Preferences.MatchThemeForCluster("dev-us-east-1")
	require.NoError(t, err)
	require.NotNil(t, matched)
	assert.Equal(t, "t-dev", matched.ID)
	assert.Equal(t, "Dev Green", matched.Name)

	// Match a prod context.
	matched, err = app.Preferences.MatchThemeForCluster("prod-eu-west-1")
	require.NoError(t, err)
	require.NotNil(t, matched)
	assert.Equal(t, "t-prod", matched.ID)
	assert.Equal(t, "Prod Red", matched.Name)
}

// TestMatchThemeForCluster_DefaultFallback verifies that MatchThemeForCluster
// returns the protected default theme when no other pattern matches.
func TestMatchThemeForCluster_DefaultFallback(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	require.NoError(t, app.Preferences.SaveTheme(Theme{ID: "t-prod", Name: "Prod Red", ClusterPattern: "prod-*"}))

	matched, err := app.Preferences.MatchThemeForCluster("staging-us-east-1")
	require.NoError(t, err)
	require.NotNil(t, matched)
	assert.Equal(t, "default", matched.ID)
}

// TestMatchThemeForCluster_FirstMatchWins verifies that when multiple themes
// match a context name, the first one in list order is returned.
func TestMatchThemeForCluster_FirstMatchWins(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	// Both patterns match "dev-cluster".
	require.NoError(t, app.Preferences.SaveTheme(Theme{ID: "t-first", Name: "First Match", ClusterPattern: "dev-*"}))
	require.NoError(t, app.Preferences.SaveTheme(Theme{ID: "t-second", Name: "Second Match", ClusterPattern: "dev-cluster"}))

	matched, err := app.Preferences.MatchThemeForCluster("dev-cluster")
	require.NoError(t, err)
	require.NotNil(t, matched)
	assert.Equal(t, "t-first", matched.ID, "expected the first matching theme in list order")
}

// TestMatchThemeForCluster_EmptyPattern verifies that themes with an empty
// ClusterPattern are treated as a catch-all "*" pattern.
func TestMatchThemeForCluster_EmptyPattern(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	// First theme has no pattern, so it behaves like "*".
	require.NoError(t, app.Preferences.SaveTheme(Theme{ID: "t-catchall", Name: "Catch All", ClusterPattern: ""}))
	require.NoError(t, app.Preferences.SaveTheme(Theme{ID: "t-dev", Name: "Dev", ClusterPattern: "dev-*"}))

	matched, err := app.Preferences.MatchThemeForCluster("dev-cluster")
	require.NoError(t, err)
	require.NotNil(t, matched)
	assert.Equal(t, "t-catchall", matched.ID, "empty pattern should match and preserve first-match ordering")

	// Empty pattern also matches a context name no explicit pattern covers.
	matched, err = app.Preferences.MatchThemeForCluster("random-cluster")
	require.NoError(t, err)
	require.NotNil(t, matched)
	assert.Equal(t, "t-catchall", matched.ID)
}

// TestMatchThemeForCluster_Wildcards tests the app glob patterns supported by
// saved themes: star (*), question mark (?), and character classes.
func TestMatchThemeForCluster_Wildcards(t *testing.T) {
	setTestConfigEnv(t)
	app := newSettingsEffectsTestFixture(t)

	// Save themes with different wildcard patterns.
	require.NoError(t, app.Preferences.SaveTheme(Theme{ID: "t-star", Name: "Star", ClusterPattern: "*dev*"}))
	require.NoError(t, app.Preferences.SaveTheme(Theme{ID: "t-question", Name: "Question", ClusterPattern: "stg-?"}))
	require.NoError(t, app.Preferences.SaveTheme(Theme{ID: "t-prefix", Name: "Prefix", ClusterPattern: "prod*"}))

	tests := []struct {
		contextName string
		expectID    string
		expectNil   bool
	}{
		// *dev* matches anything containing "dev".
		{"my-dev-cluster", "t-star", false},
		{"dev-east", "t-star", false},
		{"development", "t-star", false},

		// stg-? matches "stg-" followed by exactly one character.
		{"stg-1", "t-question", false},
		{"stg-a", "t-question", false},
		// stg-? does NOT match "stg-12" (two chars after dash), so default wins.
		{"stg-12", "default", false},

		// prod* matches anything starting with "prod".
		{"prod-us-east-1", "t-prefix", false},
		{"production", "t-prefix", false},

		// No explicit match, so default wins.
		{"local-cluster", "default", false},
		{"arn:aws:eks:us-east-1:123456789012:cluster/local", "default", false},
	}

	for _, tc := range tests {
		t.Run(tc.contextName, func(t *testing.T) {
			matched, err := app.Preferences.MatchThemeForCluster(tc.contextName)
			require.NoError(t, err)
			if tc.expectNil {
				assert.Nil(t, matched, "expected no match for %q", tc.contextName)
			} else {
				require.NotNil(t, matched, "expected a match for %q", tc.contextName)
				assert.Equal(t, tc.expectID, matched.ID)
			}
		})
	}
}

// A failed theme write must not leak into the cache that later preference writes persist.
func TestThemeLibraryMutationsPublishOnlyAfterPersistence(t *testing.T) {
	for _, operation := range []string{"save", "delete", "reorder"} {
		t.Run(operation, func(t *testing.T) {
			setTestConfigEnv(t)
			app := newSettingsEffectsTestFixture(t)
			preferences := app.Preferences
			require.NoError(t, preferences.SaveTheme(Theme{ID: "one", Name: "One"}))
			require.NoError(t, preferences.SaveTheme(Theme{ID: "two", Name: "Two"}))
			ensurePreferencesLoaded(t, preferences)
			before, err := preferences.GetAppSettings()
			require.NoError(t, err)
			path, err := preferences.getSettingsFilePath()
			require.NoError(t, err)
			diskBefore, err := os.ReadFile(path)
			require.NoError(t, err)
			mutate := func() error {
				switch operation {
				case "save":
					return preferences.SaveTheme(Theme{ID: "one", Name: "Updated"})
				case "delete":
					return preferences.DeleteTheme("one")
				default:
					return preferences.ReorderThemes([]string{"two", "one", "default"})
				}
			}
			originalWrite := writeSettingsFileAtomic
			t.Cleanup(func() { writeSettingsFileAtomic = originalWrite })
			failure := errors.New("forced theme write failure")
			writeSettingsFileAtomic = func(string, []byte, os.FileMode) error { return failure }
			require.ErrorIs(t, mutate(), failure)
			afterFailure, err := preferences.GetAppSettings()
			require.NoError(t, err)
			assert.Equal(t, before.Themes, afterFailure.Themes)
			diskAfter, err := os.ReadFile(path)
			require.NoError(t, err)
			assert.Equal(t, diskBefore, diskAfter)

			writeSettingsFileAtomic = originalWrite
			require.NoError(t, mutate())
			saved, err := preferences.GetThemes()
			require.NoError(t, err)
			assert.NotEqual(t, before.Themes, saved)
			cached, err := preferences.GetAppSettings()
			require.NoError(t, err)
			assert.Equal(t, saved, cached.Themes)
			require.NoError(t, updatePreference(preferences, preferenceschema.KeyAppearanceMode, "dark"))
			afterPreferenceWrite, err := preferences.GetThemes()
			require.NoError(t, err)
			assert.Equal(t, saved, afterPreferenceWrite)
		})
	}
}
