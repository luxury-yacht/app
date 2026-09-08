package backend

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/luxury-yacht/app/internal/appstate"
	"github.com/stretchr/testify/require"
)

func TestBackendSuiteStateProbe(t *testing.T) {
	if os.Getenv("LY_TEST_SUITE_STATE_PROBE") == "" {
		t.Skip("subprocess probe only")
	}
	manifest, err := appstate.Resolve("luxury-yacht")
	require.NoError(t, err)
	require.NoError(t, os.MkdirAll(manifest.ConfigRoot, 0o700))
	require.NoError(t, os.WriteFile(manifest.SettingsPath(), []byte("probe"), 0o600))
}

func TestBackendSuiteDoesNotWriteToInheritedUserDirectories(t *testing.T) {
	parentRoot := t.TempDir()
	command := exec.Command(os.Args[0], "-test.run=^TestBackendSuiteStateProbe$")
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		switch key {
		case "HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "APPDATA":
		default:
			command.Env = append(command.Env, entry)
		}
	}
	for _, key := range []string{"HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "APPDATA"} {
		command.Env = append(command.Env, key+"="+parentRoot)
	}
	command.Env = append(command.Env, "LY_TEST_SUITE_STATE_PROBE=1")
	output, err := command.CombinedOutput()
	require.NoError(t, err, "%s", output)
	var files []string
	require.NoError(t, filepath.WalkDir(parentRoot, func(path string, entry os.DirEntry, err error) error {
		if err == nil && !entry.IsDir() {
			files = append(files, path)
		}
		return err
	}))
	require.Empty(t, files, "backend test subprocess must isolate durable writes from its inherited user directories")
}
