package backend

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestInitializeSelectedClustersAtStartupUsesSelectionMutationCoordinator(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	app := NewApp()
	app.logger = NewLogger(10)
	selection := "/tmp/config:cluster-a"
	app.availableKubeconfigs = []KubeconfigInfo{{
		Name:    "config",
		Path:    "/tmp/config",
		Context: "cluster-a",
	}}
	settings := defaultSettingsFile()
	settings.Kubeconfig.Selected = []string{selection}
	require.NoError(t, app.saveSettingsFile(settings))

	initializerCalled := make(chan struct{})
	app.kubeClientInitializer = func() error {
		close(initializerCalled)
		return nil
	}

	app.selectionMutationMu.Lock()
	type startupResult struct {
		selectedCount int
		err           error
	}
	result := make(chan startupResult, 1)
	go func() {
		selectedCount, err := app.initializeSelectedClustersAtStartup()
		result <- startupResult{selectedCount: selectedCount, err: err}
	}()

	select {
	case <-initializerCalled:
		t.Fatal("startup initialization bypassed the selection mutation coordinator")
	case <-time.After(50 * time.Millisecond):
	}
	require.Empty(t, app.GetSelectedKubeconfigs(), "startup restore must share the selection mutation coordinator")

	app.selectionMutationMu.Unlock()
	startup := <-result
	require.NoError(t, startup.err)
	require.Equal(t, 1, startup.selectedCount)
	require.Equal(t, []string{selection}, app.GetSelectedKubeconfigs())
	require.Eventually(t, func() bool {
		select {
		case <-initializerCalled:
			return true
		default:
			return false
		}
	}, time.Second, 10*time.Millisecond)
}

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
