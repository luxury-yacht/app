package appstate_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/luxury-yacht/app/internal/appstate"
	"github.com/stretchr/testify/require"
)

func TestResolveReturnsStaticRootsWithoutCreatingThem(t *testing.T) {
	base := t.TempDir()
	t.Setenv("HOME", filepath.Join(base, "home"))
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(base, "config"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(base, "cache"))
	t.Setenv("APPDATA", filepath.Join(base, "appdata"))

	manifest, err := appstate.Resolve("luxury-yacht")
	require.NoError(t, err)
	require.Equal(t, []string{manifest.ConfigRoot, manifest.CacheRoot}, manifest.StaticRoots())
	for _, root := range manifest.StaticRoots() {
		_, statErr := os.Lstat(root)
		require.ErrorIs(t, statErr, os.ErrNotExist)
	}
	require.Equal(t, filepath.Join(manifest.ConfigRoot, "settings.json"), manifest.SettingsPath())
	require.Equal(t, filepath.Join(manifest.ConfigRoot, "favorites.json"), manifest.FavoritesPath())
	require.Equal(t, filepath.Join(manifest.ConfigRoot, "persistence.json"), manifest.UIStatePath())
	require.Equal(t, filepath.Join(manifest.ConfigRoot, "application-update.json"), manifest.UpdateStatePath())
}

func TestResolveRejectsEmptyAppName(t *testing.T) {
	_, err := appstate.Resolve("")
	require.ErrorContains(t, err, "empty app name")
}
