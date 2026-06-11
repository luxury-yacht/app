package backend

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/authstate"
	"github.com/stretchr/testify/require"
)

// writeTestKubeconfig writes a kubeconfig pointing at the given server URL and
// returns its path. The context is named "test-context".
func writeTestKubeconfig(t *testing.T, serverURL string) string {
	t.Helper()
	configPath := filepath.Join(t.TempDir(), "config")
	kubeconfig := fmt.Sprintf(`apiVersion: v1
clusters:
- cluster:
    server: %s
  name: test-cluster
contexts:
- context:
    cluster: test-cluster
    user: test-user
  name: test-context
current-context: test-context
kind: Config
preferences: {}
users:
- name: test-user
  user:
    token: test-token
`, serverURL)
	require.NoError(t, os.WriteFile(configPath, []byte(kubeconfig), 0o600))
	return configPath
}

// TestBuildClusterClientsWithManagerWiresTransportToProvidedManager pins the
// rebuild contract: when an existing auth manager is supplied, the built
// clients' HTTP transports must report auth failures to THAT manager — not to
// a manager that is created internally and then discarded. A 401 seen by the
// transport must therefore transition the provided manager.
func TestBuildClusterClientsWithManagerWiresTransportToProvidedManager(t *testing.T) {
	var unauthorized bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if unauthorized {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"major":"1","minor":"30"}`))
	}))
	defer server.Close()

	app := newTestAppWithDefaults(t)
	configPath := writeTestKubeconfig(t, server.URL)

	mgr := authstate.New(authstate.Config{MaxAttempts: 0})
	defer mgr.Shutdown()

	clients, err := app.buildClusterClientsWithManager(
		context.Background(),
		kubeconfigSelection{Path: configPath, Context: "test-context"},
		ClusterMeta{ID: "test-cluster", Name: "Test Cluster"},
		mgr,
	)
	require.NoError(t, err)
	require.Same(t, mgr, clients.authManager, "built clients must track the provided manager")
	require.True(t, mgr.IsValid(), "healthy preflight must leave the provided manager valid")

	// A 401 through the built clientset must be reported to the provided manager.
	unauthorized = true
	_, err = clients.client.Discovery().RESTClient().Get().AbsPath("/version").DoRaw(context.Background())
	require.Error(t, err)

	state, _ := mgr.State()
	require.Equal(t, authstate.StateInvalid, state,
		"transport must report the 401 to the provided manager")
}

// TestBuildClusterClientsWithManagerLeavesReusedManagerRunningOnError pins the
// error-path contract: a build failure must not shut down a manager it does
// not own — the previous clients still reference it.
func TestBuildClusterClientsWithManagerLeavesReusedManagerRunningOnError(t *testing.T) {
	app := newTestAppWithDefaults(t)

	mgr := authstate.New(authstate.Config{
		MaxAttempts:     1,
		BackoffSchedule: []time.Duration{0},
		RecoveryTest:    func() error { return nil },
	})
	defer mgr.Shutdown()

	_, err := app.buildClusterClientsWithManager(
		context.Background(),
		kubeconfigSelection{Path: filepath.Join(t.TempDir(), "missing"), Context: "nope"},
		ClusterMeta{ID: "test-cluster", Name: "Test Cluster"},
		mgr,
	)
	require.Error(t, err)

	// The manager's recovery machinery must still be alive: a failure must
	// recover to valid via the always-succeeding RecoveryTest. A shut-down
	// manager would stay stuck in recovering.
	mgr.ReportFailure("test failure")
	require.Eventually(t, func() bool {
		return mgr.IsValid()
	}, time.Second, 5*time.Millisecond, "reused manager must not be shut down by a failed build")
}

func TestClusterClientBuildConcurrencyLimit(t *testing.T) {
	require.Equal(t, 0, clusterClientBuildConcurrencyLimit(0))
	require.Equal(t, 1, clusterClientBuildConcurrencyLimit(1))

	limit := runtime.GOMAXPROCS(0)
	if limit <= 0 {
		limit = 1
	}

	// Small batches run at full batch width.
	require.Equal(t, 2, clusterClientBuildConcurrencyLimit(2))

	// Large batches are capped at runtime parallelism.
	taskCount := limit + 3
	require.Equal(t, limit, clusterClientBuildConcurrencyLimit(taskCount))
}
