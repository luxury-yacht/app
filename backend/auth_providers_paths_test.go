package backend

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestDefaultExecutableSearchDirectoriesExcludesProviderPaths pins the Phase 2
// contract: the app injects only generic desktop executable directories into
// PATH and never cloud-provider install locations (Google Cloud SDK / Caskroom),
// even when those directories exist under HOME.
func TestDefaultExecutableSearchDirectoriesExcludesProviderPaths(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	localBin := filepath.Join(home, ".local", "bin")
	gcloudBin := filepath.Join(home, "google-cloud-sdk", "bin")
	require.NoError(t, os.MkdirAll(localBin, 0o755))
	require.NoError(t, os.MkdirAll(gcloudBin, 0o755))

	dirs := defaultExecutableSearchDirectories()

	require.Contains(t, dirs, localBin, "generic $HOME/.local/bin must still be offered")
	require.NotContains(t, dirs, gcloudBin, "provider google-cloud-sdk/bin must not be injected")
	for _, dir := range dirs {
		require.NotContains(t, dir, "google-cloud-sdk", "no provider path may be injected: %s", dir)
		require.NotContains(t, dir, "Caskroom", "no provider path may be injected: %s", dir)
	}
}

func TestEnsurePathContainsHandlesDuplicates(t *testing.T) {
	original := "/usr/bin:/opt/bin"
	if got := ensurePathContains(original, "/opt/bin"); got != original {
		t.Fatalf("expected duplicate candidate to keep path unchanged, got %s", got)
	}

	if got := ensurePathContains("", "/custom/bin"); got != "/custom/bin" {
		t.Fatalf("expected empty path to return candidate, got %s", got)
	}
}

func TestMergePathListsDeduplicatesAndTrims(t *testing.T) {
	list := mergePathLists("/usr/bin:/bin", " /usr/bin :/sbin", "", "/opt/bin")
	expected := "/usr/bin" + string(os.PathListSeparator) + "/bin" + string(os.PathListSeparator) + "/sbin" + string(os.PathListSeparator) + "/opt/bin"
	if list != expected {
		t.Fatalf("unexpected merged path: %s", list)
	}
}

func TestSetupEnvironmentHandlesNilApp(t *testing.T) {
	var app *App
	app.setupEnvironment()
}

func TestResolveHomeDirUsesEnv(t *testing.T) {
	origHome := os.Getenv("HOME")
	t.Cleanup(func() {
		_ = os.Setenv("HOME", origHome)
	})

	_ = os.Setenv("HOME", "/tmp/customhome")
	if home := resolveHomeDir(); home != "/tmp/customhome" {
		t.Fatalf("expected HOME to be used, got %s", home)
	}
}
