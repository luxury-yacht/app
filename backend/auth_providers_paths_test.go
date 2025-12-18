package backend

import (
	"os"
	"testing"
)

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
