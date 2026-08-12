package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// appStateDirs returns the directories the installed app persists state in:
// the config dir (settings.json, persistence.json, favorites.json) and the
// cache dir (API discovery, maintained-store spill, diagnostic dumps).
//
// These must resolve the same way the backend resolves them — see
// getSettingsFilePath and cacheDirPath in backend/app_settings.go, which join
// the app name onto os.UserConfigDir and os.UserCacheDir. Those bases differ
// per platform (~/Library/... on macOS, ~/.config and ~/.cache on Linux), so a
// hardcoded path resets nothing on the platforms it does not match.
func appStateDirs(appShortName string) ([]string, error) {
	if appShortName == "" {
		// An empty name joins to the bare base directory, which would put every
		// application's state under a subsequent removal.
		return nil, errors.New("resolve app state dirs: empty app name")
	}
	configBase, err := os.UserConfigDir()
	if err != nil {
		return nil, fmt.Errorf("resolve user config dir: %w", err)
	}
	cacheBase, err := os.UserCacheDir()
	if err != nil {
		return nil, fmt.Errorf("resolve user cache dir: %w", err)
	}
	return []string{
		filepath.Join(configBase, appShortName),
		filepath.Join(cacheBase, appShortName),
	}, nil
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
