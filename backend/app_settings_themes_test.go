package backend

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestGetThemes_Empty verifies that GetThemes returns an empty slice when no
// themes have been saved.
func TestGetThemes_Empty(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	themes, err := app.GetThemes()
	require.NoError(t, err)
	assert.Empty(t, themes)
	// Ensure we get an empty slice, not nil, so JSON serialises to [].
	assert.NotNil(t, themes)
}

// TestSaveTheme_Create verifies that saving a theme with a new ID appends it
// to the theme list.
func TestSaveTheme_Create(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	theme := Theme{
		ID:             "t-1",
		Name:           "Danger Red",
		ClusterPattern: "prod*",
		PaletteHueLight: 0,
	}

	require.NoError(t, app.SaveTheme(theme))

	themes, err := app.GetThemes()
	require.NoError(t, err)
	require.Len(t, themes, 1)
	assert.Equal(t, "t-1", themes[0].ID)
	assert.Equal(t, "Danger Red", themes[0].Name)
	assert.Equal(t, "prod*", themes[0].ClusterPattern)
}

// TestSaveTheme_Update verifies that saving a theme with an existing ID
// updates it in place without changing the list length.
func TestSaveTheme_Update(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	// Create two themes.
	require.NoError(t, app.SaveTheme(Theme{ID: "t-1", Name: "Red"}))
	require.NoError(t, app.SaveTheme(Theme{ID: "t-2", Name: "Blue"}))

	// Update the first theme.
	require.NoError(t, app.SaveTheme(Theme{ID: "t-1", Name: "Updated Red", ClusterPattern: "staging*"}))

	themes, err := app.GetThemes()
	require.NoError(t, err)
	require.Len(t, themes, 2)
	// Order is preserved; the first theme should be the updated one.
	assert.Equal(t, "t-1", themes[0].ID)
	assert.Equal(t, "Updated Red", themes[0].Name)
	assert.Equal(t, "staging*", themes[0].ClusterPattern)
	// Second theme unchanged.
	assert.Equal(t, "t-2", themes[1].ID)
	assert.Equal(t, "Blue", themes[1].Name)
}

// TestSaveTheme_Validation verifies that SaveTheme rejects themes without
// required fields.
func TestSaveTheme_Validation(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	// Missing ID.
	err := app.SaveTheme(Theme{Name: "No ID"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "theme ID is required")

	// Missing name.
	err = app.SaveTheme(Theme{ID: "t-1"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "theme name is required")
}

// TestDeleteTheme verifies that DeleteTheme removes a theme by ID.
func TestDeleteTheme(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	// Seed two themes.
	require.NoError(t, app.SaveTheme(Theme{ID: "t-1", Name: "Red"}))
	require.NoError(t, app.SaveTheme(Theme{ID: "t-2", Name: "Blue"}))

	// Delete the first.
	require.NoError(t, app.DeleteTheme("t-1"))

	themes, err := app.GetThemes()
	require.NoError(t, err)
	require.Len(t, themes, 1)
	assert.Equal(t, "t-2", themes[0].ID)
}

// TestDeleteTheme_NotFound verifies that deleting a non-existent theme ID
// returns an error.
func TestDeleteTheme_NotFound(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	err := app.DeleteTheme("non-existent")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "theme not found: non-existent")
}

// TestReorderThemes verifies that ReorderThemes rearranges themes according to
// the supplied ID list.
func TestReorderThemes(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	// Seed three themes in order.
	require.NoError(t, app.SaveTheme(Theme{ID: "t-1", Name: "Red"}))
	require.NoError(t, app.SaveTheme(Theme{ID: "t-2", Name: "Blue"}))
	require.NoError(t, app.SaveTheme(Theme{ID: "t-3", Name: "Green"}))

	// Reorder: reverse the list.
	require.NoError(t, app.ReorderThemes([]string{"t-3", "t-2", "t-1"}))

	themes, err := app.GetThemes()
	require.NoError(t, err)
	require.Len(t, themes, 3)
	assert.Equal(t, "t-3", themes[0].ID)
	assert.Equal(t, "t-2", themes[1].ID)
	assert.Equal(t, "t-1", themes[2].ID)
	// Verify full theme data survived the reorder.
	assert.Equal(t, "Green", themes[0].Name)
	assert.Equal(t, "Blue", themes[1].Name)
	assert.Equal(t, "Red", themes[2].Name)
}

// TestReorderThemes_InvalidIDs verifies that ReorderThemes returns errors for
// mismatched ID lists.
func TestReorderThemes_InvalidIDs(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	require.NoError(t, app.SaveTheme(Theme{ID: "t-1", Name: "Red"}))
	require.NoError(t, app.SaveTheme(Theme{ID: "t-2", Name: "Blue"}))

	// Wrong count (too few IDs).
	err := app.ReorderThemes([]string{"t-1"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "id count mismatch")

	// Wrong count (too many IDs).
	err = app.ReorderThemes([]string{"t-1", "t-2", "t-3"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "id count mismatch")

	// Correct count but unknown ID.
	err = app.ReorderThemes([]string{"t-1", "unknown"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unknown theme ID: unknown")
}

// TestApplyTheme verifies that ApplyTheme copies a saved theme's palette values
// into the active settings fields.
func TestApplyTheme(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

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
	require.NoError(t, app.SaveTheme(theme))

	// Apply the theme.
	require.NoError(t, app.ApplyTheme("t-apply"))

	// Verify the active palette fields in settings match the theme's values.
	settings, err := app.loadSettingsFile()
	require.NoError(t, err)
	assert.Equal(t, 210, settings.Preferences.PaletteHueLight)
	assert.Equal(t, 80, settings.Preferences.PaletteSaturationLight)
	assert.Equal(t, 10, settings.Preferences.PaletteBrightnessLight)
	assert.Equal(t, 220, settings.Preferences.PaletteHueDark)
	assert.Equal(t, 70, settings.Preferences.PaletteSaturationDark)
	assert.Equal(t, -15, settings.Preferences.PaletteBrightnessDark)
	assert.Equal(t, "#0077cc", settings.Preferences.AccentColorLight)
	assert.Equal(t, "#3399ff", settings.Preferences.AccentColorDark)
}

// TestApplyTheme_NotFound verifies that ApplyTheme returns an error when the
// requested theme ID does not exist.
func TestApplyTheme_NotFound(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	err := app.ApplyTheme("non-existent")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "theme not found: non-existent")
}

// TestMatchThemeForCluster_Match verifies that MatchThemeForCluster returns the
// correct theme when a pattern matches the given context name.
func TestMatchThemeForCluster_Match(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	// Save themes with patterns.
	require.NoError(t, app.SaveTheme(Theme{ID: "t-dev", Name: "Dev Green", ClusterPattern: "dev-*"}))
	require.NoError(t, app.SaveTheme(Theme{ID: "t-prod", Name: "Prod Red", ClusterPattern: "prod-*"}))

	// Match a dev context.
	matched, err := app.MatchThemeForCluster("dev-us-east-1")
	require.NoError(t, err)
	require.NotNil(t, matched)
	assert.Equal(t, "t-dev", matched.ID)
	assert.Equal(t, "Dev Green", matched.Name)

	// Match a prod context.
	matched, err = app.MatchThemeForCluster("prod-eu-west-1")
	require.NoError(t, err)
	require.NotNil(t, matched)
	assert.Equal(t, "t-prod", matched.ID)
	assert.Equal(t, "Prod Red", matched.Name)
}

// TestMatchThemeForCluster_NoMatch verifies that MatchThemeForCluster returns
// nil when no saved theme pattern matches the context name.
func TestMatchThemeForCluster_NoMatch(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	require.NoError(t, app.SaveTheme(Theme{ID: "t-prod", Name: "Prod Red", ClusterPattern: "prod-*"}))

	matched, err := app.MatchThemeForCluster("staging-us-east-1")
	require.NoError(t, err)
	assert.Nil(t, matched)
}

// TestMatchThemeForCluster_FirstMatchWins verifies that when multiple themes
// match a context name, the first one in list order is returned.
func TestMatchThemeForCluster_FirstMatchWins(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	// Both patterns match "dev-cluster".
	require.NoError(t, app.SaveTheme(Theme{ID: "t-first", Name: "First Match", ClusterPattern: "dev-*"}))
	require.NoError(t, app.SaveTheme(Theme{ID: "t-second", Name: "Second Match", ClusterPattern: "dev-cluster"}))

	matched, err := app.MatchThemeForCluster("dev-cluster")
	require.NoError(t, err)
	require.NotNil(t, matched)
	assert.Equal(t, "t-first", matched.ID, "expected the first matching theme in list order")
}

// TestMatchThemeForCluster_EmptyPattern verifies that themes with an empty
// ClusterPattern are skipped during matching.
func TestMatchThemeForCluster_EmptyPattern(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	// First theme has no pattern, second does.
	require.NoError(t, app.SaveTheme(Theme{ID: "t-nopat", Name: "No Pattern", ClusterPattern: ""}))
	require.NoError(t, app.SaveTheme(Theme{ID: "t-dev", Name: "Dev", ClusterPattern: "dev-*"}))

	matched, err := app.MatchThemeForCluster("dev-cluster")
	require.NoError(t, err)
	require.NotNil(t, matched)
	assert.Equal(t, "t-dev", matched.ID, "theme with empty pattern should be skipped")

	// With a context name that only the empty-pattern theme could match, we get nil.
	matched, err = app.MatchThemeForCluster("random-cluster")
	require.NoError(t, err)
	assert.Nil(t, matched)
}

// TestMatchThemeForCluster_Wildcards tests various glob patterns supported by
// filepath.Match: star (*), question mark (?), and character classes.
func TestMatchThemeForCluster_Wildcards(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	// Save themes with different wildcard patterns.
	require.NoError(t, app.SaveTheme(Theme{ID: "t-star", Name: "Star", ClusterPattern: "*dev*"}))
	require.NoError(t, app.SaveTheme(Theme{ID: "t-question", Name: "Question", ClusterPattern: "stg-?"}))
	require.NoError(t, app.SaveTheme(Theme{ID: "t-prefix", Name: "Prefix", ClusterPattern: "prod*"}))

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
		// stg-? does NOT match "stg-12" (two chars after dash).
		{"stg-12", "", true},

		// prod* matches anything starting with "prod".
		{"prod-us-east-1", "t-prefix", false},
		{"production", "t-prefix", false},

		// No match.
		{"local-cluster", "", true},
	}

	for _, tc := range tests {
		t.Run(tc.contextName, func(t *testing.T) {
			matched, err := app.MatchThemeForCluster(tc.contextName)
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
