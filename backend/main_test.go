package backend

import (
	"os"
	"testing"

	"github.com/luxury-yacht/app/backend/internal/errorcapture"
)

func TestMain(m *testing.M) {
	// Production installs these before any Kubernetes client or informer can
	// start. Mirror that process boundary for tests so a later startup test never
	// replaces stderr while another test's background reflector is logging.
	errorcapture.Init()
	errorcapture.InstallUnhandledErrorDedup()
	os.Exit(m.Run())
}
