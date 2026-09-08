package backend

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/luxury-yacht/app/backend/internal/errorcapture"
)

func TestMain(m *testing.M) {
	MaybeRunExecWrapper()
	if os.Getenv("LY_TEST_CREDENTIAL_MODE") != "" {
		// The subprocess models an external helper writing directly to stderr.
		os.Exit(m.Run())
	}
	// Production installs these before any Kubernetes client or informer can
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
