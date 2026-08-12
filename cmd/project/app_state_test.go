package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// redirectUserDirs points the OS user-config and user-cache lookups at a temp
// directory so state-removal tests can never touch the developer's real files.
func redirectUserDirs(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	// Empty means "unset" to os.UserConfigDir/os.UserCacheDir, which then fall
	// back to $HOME; setting them explicitly keeps the test deterministic on
	// machines that export XDG paths.
	t.Setenv("XDG_CONFIG_HOME", "")
	t.Setenv("XDG_CACHE_HOME", "")
	t.Setenv("AppData", filepath.Join(home, "AppData", "Roaming"))
	t.Setenv("LocalAppData", filepath.Join(home, "AppData", "Local"))
	return home
}

// wantStateDirs mirrors the platform bases os.UserConfigDir/os.UserCacheDir
// document, spelled out so the test fails if the resolver hardcodes one
// platform's layout.
func wantStateDirs(t *testing.T, home, appName string) (string, string) {
	t.Helper()
	switch runtime.GOOS {
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", appName),
			filepath.Join(home, "Library", "Caches", appName)
	case "windows":
		return filepath.Join(home, "AppData", "Roaming", appName),
			filepath.Join(home, "AppData", "Local", appName)
	default:
		return filepath.Join(home, ".config", appName),
			filepath.Join(home, ".cache", appName)
	}
}

func TestAppStateDirsUsePlatformStateBases(t *testing.T) {
	home := redirectUserDirs(t)
	wantConfig, wantCache := wantStateDirs(t, home, "luxury-yacht")

	dirs, err := AppStateDirs("luxury-yacht")
	if err != nil {
		t.Fatalf("AppStateDirs: %v", err)
	}

	want := []string{wantConfig, wantCache}
	if len(dirs) != len(want) {
		t.Fatalf("AppStateDirs returned %d dirs (%v), want %d", len(dirs), dirs, len(want))
	}
	for i := range want {
		if dirs[i] != want[i] {
			t.Errorf("AppStateDirs()[%d] = %q, want %q", i, dirs[i], want[i])
		}
	}
}

func TestResetAppStateRemovesStateDirs(t *testing.T) {
	home := redirectUserDirs(t)
	configDir, cacheDir := wantStateDirs(t, home, "luxury-yacht")

	// A sibling directory under the same bases proves the removal is scoped to
	// the app rather than to the whole user config/cache tree.
	sibling := filepath.Join(filepath.Dir(configDir), "another-app")
	for _, path := range []string{
		filepath.Join(configDir, "settings.json"),
		filepath.Join(cacheDir, "discovery", "cached.json"),
		filepath.Join(sibling, "keep.json"),
	} {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatalf("seed %s: %v", path, err)
		}
		if err := os.WriteFile(path, []byte("{}"), 0o600); err != nil {
			t.Fatalf("seed %s: %v", path, err)
		}
	}

	removed, err := ResetAppState("luxury-yacht")
	if err != nil {
		t.Fatalf("ResetAppState: %v", err)
	}

	for _, dir := range []string{configDir, cacheDir} {
		if _, statErr := os.Stat(dir); !os.IsNotExist(statErr) {
			t.Errorf("%s still exists after reset (stat err %v)", dir, statErr)
		}
		if !containsPath(removed, dir) {
			t.Errorf("ResetAppState reported %v, missing %s", removed, dir)
		}
	}
	if _, statErr := os.Stat(sibling); statErr != nil {
		t.Errorf("sibling %s was removed: %v", sibling, statErr)
	}

	// Reset must stay re-runnable once the directories are gone.
	if _, err := ResetAppState("luxury-yacht"); err != nil {
		t.Errorf("second ResetAppState on missing dirs: %v", err)
	}
}

func TestResetAppStateRejectsEmptyAppName(t *testing.T) {
	home := redirectUserDirs(t)
	configBase, err := os.UserConfigDir()
	if err != nil {
		t.Fatalf("UserConfigDir: %v", err)
	}
	if !strings.HasPrefix(configBase, home) {
		t.Fatalf("config base %q escaped the temp home %q", configBase, home)
	}
	if err := os.MkdirAll(configBase, 0o755); err != nil {
		t.Fatalf("seed %s: %v", configBase, err)
	}

	// An empty name would join to the bare base directory, so removing it would
	// wipe every application's config, not just this app's.
	if _, err := ResetAppState(""); err == nil {
		t.Fatal("ResetAppState(\"\") returned no error")
	}
	if _, err := os.Stat(configBase); err != nil {
		t.Fatalf("config base %s was removed: %v", configBase, err)
	}
}

func containsPath(paths []string, want string) bool {
	for _, path := range paths {
		if path == want {
			return true
		}
	}
	return false
}
