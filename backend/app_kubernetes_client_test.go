package backend

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestInitKubernetesClient_FailsWithNoSelections verifies that initKubernetesClient
// returns an error when no kubeconfig selections are configured. This is the
// primary guard that prevents the app from proceeding without any cluster config.
func TestInitKubernetesClient_FailsWithNoSelections(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()

	// No selectedKubeconfigs set — should fail.
	err := app.initKubernetesClient()
	require.Error(t, err)
	require.Contains(t, err.Error(), "no kubeconfig selections available")
}

// TestInitKubernetesClient_FailsWithEmptySelections verifies that an explicitly
// empty selection list also produces the expected error.
func TestInitKubernetesClient_FailsWithEmptySelections(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	app.selectedKubeconfigs = []string{}

	err := app.initKubernetesClient()
	require.Error(t, err)
	require.Contains(t, err.Error(), "no kubeconfig selections available")
}

// TestInitKubernetesClient_FailsWithInvalidSelection verifies that a malformed
// kubeconfig selection string causes an error during normalization/validation.
func TestInitKubernetesClient_FailsWithInvalidSelection(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()

	// A selection string that doesn't resolve to a valid kubeconfig path.
	app.selectedKubeconfigs = []string{"/nonexistent/path:context"}

	err := app.initKubernetesClient()
	require.Error(t, err, "initKubernetesClient should fail with invalid kubeconfig path")
}

// TestInitKubernetesClient_SuccessCase documents what would be needed for a full
// success-path test. The existing TestInitKubernetesClientFailsWhenRefreshSubsystemFails
// in app_lifecycle_test.go already exercises the success path up through the
// syncClusterClientPool call by pre-populating clusterClients and only failing
// at the refresh subsystem stage. A true end-to-end success test would need:
//   - A valid kubeconfig file on disk
//   - Pre-populated clusterClients (or a mock build pipeline)
//   - A working refresh subsystem (or mock via newRefreshSubsystemWithServices)
//   - An object catalog that doesn't crash on start
//
// The existing test in app_lifecycle_test.go (TestInitKubernetesClientFailsWhenRefreshSubsystemFails)
// serves as a partial success-path safety net since it exercises the sync path.
