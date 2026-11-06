package backend

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/luxury-yacht/app/backend/internal/errorcapture"
)

func TestMain(m *testing.M) {
	MaybeRunExecWrapper()
	if os.Getenv("LY_TEST_CREDENTIAL_MODE") != "" {
		// The subprocess models an external helper writing directly to stderr.
		os.Exit(m.Run())
	}
	// Production installs these before any Kubernetes client or reflector can
	// start. Mirror that process boundary for tests so a later startup test never
	// replaces stderr while another test's background reflector is logging.
	errorcapture.Init()
	errorcapture.InstallUnhandledErrorDedup()
	os.Exit(runIsolatedBackendTests(m))
}

// Some owner fixtures persist without a per-test directory override. Isolate the
// entire process, including late background work after a test restores its env.
func runIsolatedBackendTests(m *testing.M) int {
	stateRoot, err := os.MkdirTemp("", "luxury-yacht-backend-tests-")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer os.RemoveAll(stateRoot)
	pinGoToolchainDirs()
	for key, directory := range map[string]string{
		"HOME":            stateRoot,
		"XDG_CONFIG_HOME": filepath.Join(stateRoot, "config"),
		"XDG_CACHE_HOME":  filepath.Join(stateRoot, "cache"),
		"APPDATA":         filepath.Join(stateRoot, "appdata"),
	} {
		if err := os.Setenv(key, directory); err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
	}
	return m.Run()
}

// pinGoToolchainDirs keeps go subprocesses (the refresh-contract renderer's
// packages.Load) on the real build and module caches. Go derives their defaults
// from HOME, so after isolation every load rebuilt from an empty cache (~20 s).
// It resolves Go's documented defaults itself: running `go env` here would
// write Go telemetry under the inherited HOME before isolation.
func pinGoToolchainDirs() {
	configDir, configErr := os.UserConfigDir()
	cacheDir, cacheErr := os.UserCacheDir()
	home, homeErr := os.UserHomeDir()
	if configErr != nil || cacheErr != nil || homeErr != nil {
		return
	}
	goEnvFile := os.Getenv("GOENV")
	if goEnvFile == "" {
		goEnvFile = filepath.Join(configDir, "go", "env")
		_ = os.Setenv("GOENV", goEnvFile)
	}
	// Settings saved with `go env -w` live in that file and must keep winning.
	saved, _ := os.ReadFile(goEnvFile)
	for key, fallback := range map[string]string{
		"GOCACHE": filepath.Join(cacheDir, "go-build"),
		"GOPATH":  filepath.Join(home, "go"),
	} {
		if os.Getenv(key) == "" && !goEnvFileSets(string(saved), key) {
			_ = os.Setenv(key, fallback)
		}
	}
}

func goEnvFileSets(content, key string) bool {
	for _, line := range strings.Split(content, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), key+"=") {
			return true
		}
	}
	return false
}
