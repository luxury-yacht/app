package main

import (
	"errors"
	"fmt"
	"os"

	"github.com/luxury-yacht/app/internal/appstate"
)

// appStateDirs returns the directories the installed app persists state in:
// the config dir (settings.json, persistence.json, favorites.json) and the
// cache dir (API discovery, maintained-store spill, diagnostic dumps).
//
// These must resolve the same way the backend resolves them — see
// getSettingsFilePath and cacheDirPath in backend/preferences_settings.go, which join
// the app name onto os.UserConfigDir and os.UserCacheDir. Those bases differ
// per platform (~/Library/... on macOS, ~/.config and ~/.cache on Linux), so a
// hardcoded path resets nothing on the platforms it does not match.
func appStateDirs(appShortName string) ([]string, error) {
	manifest, err := appstate.Resolve(appShortName)
	if err != nil {
		return nil, err
	}
	return manifest.StaticRoots(), nil
}

// resetAppState removes every app state directory and returns the paths it
// removed. Directories that are already absent are not an error, so a reset
// can be re-run. Every directory is attempted even if an earlier one fails.
func resetAppState(appShortName string) ([]string, error) {
	dirs, err := appStateDirs(appShortName)
	if err != nil {
		return nil, err
	}
	var errs []error
	for _, dir := range dirs {
		if err := os.RemoveAll(dir); err != nil {
			errs = append(errs, fmt.Errorf("remove %s: %w", dir, err))
		}
	}
	return dirs, errors.Join(errs...)
}
