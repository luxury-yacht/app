package backend

import (
	"os"
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
	os.Exit(m.Run())
}
