package backend

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/authstate"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/stretchr/testify/require"
	cgofake "k8s.io/client-go/kubernetes/fake"
)

func TestSetSelectedKubeconfigsKeepsRefreshServerOnSelectionChange(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()

	// Stub refresh wiring so selection updates exercise the in-place path.
	app.refreshCtx = context.Background()
	app.refreshHTTPServer = &http.Server{}
	app.refreshAggregates = &refreshAggregateHandlers{}

	app.availableKubeconfigs = []KubeconfigInfo{
		{Name: "config-a", Path: "/path/a", Context: "ctx-a"},
		{Name: "config-b", Path: "/path/b", Context: "ctx-b"},
	}
	selectionA := kubeconfigSelection{Path: "/path/a", Context: "ctx-a"}
	selectionB := kubeconfigSelection{Path: "/path/b", Context: "ctx-b"}
	clusterA := app.clusterMetaForSelection(selectionA).ID
	clusterB := app.clusterMetaForSelection(selectionB).ID

	app.selectedKubeconfigs = []string{selectionA.String()}
	app.clusterClients = map[string]*clusterClients{
		clusterA: {
			meta:              ClusterMeta{ID: clusterA, Name: "ctx-a"},
			kubeconfigPath:    selectionA.Path,
			kubeconfigContext: selectionA.Context,
			client:            cgofake.NewClientset(),
		},
		clusterB: {
			meta:              ClusterMeta{ID: clusterB, Name: "ctx-b"},
			kubeconfigPath:    selectionB.Path,
			kubeconfigContext: selectionB.Context,
			client:            cgofake.NewClientset(),
		},
	}

	originalServer := app.refreshHTTPServer
	existingSubsystem := &system.Subsystem{}
	app.refreshSubsystems = map[string]*system.Subsystem{clusterA: existingSubsystem}

	originalBuilder := newRefreshSubsystemWithServices
	newRefreshSubsystemWithServices = func(system.Config) (*system.Subsystem, error) {
		return &system.Subsystem{}, nil
	}
	t.Cleanup(func() { newRefreshSubsystemWithServices = originalBuilder })

	require.NoError(t, app.SetSelectedKubeconfigs([]string{selectionA.String(), selectionB.String()}))
	require.Same(t, originalServer, app.refreshHTTPServer)
	require.Same(t, existingSubsystem, app.refreshSubsystems[clusterA])
	require.NotNil(t, app.refreshSubsystems[clusterB])

	remainingSubsystem := app.refreshSubsystems[clusterB]
	require.NoError(t, app.SetSelectedKubeconfigs([]string{selectionB.String()}))
	require.Same(t, originalServer, app.refreshHTTPServer)
	require.Equal(t, 1, len(app.refreshSubsystems))
	require.Same(t, remainingSubsystem, app.refreshSubsystems[clusterB])
}

// TestAuthFailedClusterDoesNotBlockNewClusterSelection verifies that when one cluster
// has an auth failure, adding a new healthy cluster still succeeds.
// This is a critical isolation test - auth failures in one cluster must NEVER
// prevent the user from opening/adding other clusters.
func TestAuthFailedClusterDoesNotBlockNewClusterSelection(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()

	// Stub refresh wiring so selection updates exercise the in-place path.
	app.refreshCtx = context.Background()
	app.refreshHTTPServer = &http.Server{}
	app.refreshAggregates = &refreshAggregateHandlers{}

	app.availableKubeconfigs = []KubeconfigInfo{
		{Name: "config-a", Path: "/path/a", Context: "ctx-a"},
		{Name: "config-b", Path: "/path/b", Context: "ctx-b"},
	}
	selectionA := kubeconfigSelection{Path: "/path/a", Context: "ctx-a"}
	selectionB := kubeconfigSelection{Path: "/path/b", Context: "ctx-b"}
	clusterA := app.clusterMetaForSelection(selectionA).ID
	clusterB := app.clusterMetaForSelection(selectionB).ID

	// Create an auth manager for cluster A that reports auth failure.
	// Set MaxAttempts to 0 to disable automatic recovery, ensuring the auth manager
	// stays in StateInvalid after ReportFailure is called.
	authMgrA := authstate.New(authstate.Config{
		MaxAttempts:   0, // Disable auto-recovery so state stays Invalid
		OnStateChange: func(authstate.State, string) {},
	})
	// Force auth manager into invalid state by reporting a failure.
	// With MaxAttempts=0, this immediately transitions to StateInvalid.
	authMgrA.ReportFailure("test auth failure")

	// Set up cluster A as having auth failure (no subsystem, auth manager in failed state).
	// Set up cluster B as a healthy cluster that we're trying to add.
	app.selectedKubeconfigs = []string{selectionA.String()}
	app.clusterClients = map[string]*clusterClients{
		clusterA: {
			meta:              ClusterMeta{ID: clusterA, Name: "ctx-a"},
			kubeconfigPath:    selectionA.Path,
			kubeconfigContext: selectionA.Context,
			client:            cgofake.NewClientset(),
			authManager:       authMgrA,
			authFailedOnInit:  false, // Auth failed later, not on init
		},
		clusterB: {
			meta:              ClusterMeta{ID: clusterB, Name: "ctx-b"},
			kubeconfigPath:    selectionB.Path,
			kubeconfigContext: selectionB.Context,
			client:            cgofake.NewClientset(),
		},
	}

	// Cluster A has NO subsystem because auth failed (mirrors real behavior).
	app.refreshSubsystems = map[string]*system.Subsystem{}

	// Track whether the subsystem builder was called for each cluster.
	builderCalls := make(map[string]bool)
	originalBuilder := newRefreshSubsystemWithServices
	newRefreshSubsystemWithServices = func(cfg system.Config) (*system.Subsystem, error) {
		builderCalls[cfg.ClusterID] = true
		return &system.Subsystem{}, nil
	}
	t.Cleanup(func() { newRefreshSubsystemWithServices = originalBuilder })

	// Add cluster B while cluster A has auth failure.
	// This should NOT block - cluster B should be added successfully.
	err := app.SetSelectedKubeconfigs([]string{selectionA.String(), selectionB.String()})
	require.NoError(t, err, "Adding healthy cluster B should succeed even when cluster A has auth failure")

	// Verify cluster B got a subsystem created.
	require.True(t, builderCalls[clusterB], "Subsystem builder should be called for healthy cluster B")

	// Verify cluster A did NOT get a subsystem created (it has auth failure).
	require.False(t, builderCalls[clusterA], "Subsystem builder should NOT be called for auth-failed cluster A")

	// Verify cluster B has a subsystem but cluster A does not.
	require.NotNil(t, app.refreshSubsystems[clusterB], "Cluster B should have a subsystem")
	require.Nil(t, app.refreshSubsystems[clusterA], "Cluster A should NOT have a subsystem (auth failed)")
}

// TestAuthFailedOnInitClusterDoesNotBlockNewClusterSelection verifies that when one cluster
// has authFailedOnInit=true, adding a new healthy cluster still succeeds.
func TestAuthFailedOnInitClusterDoesNotBlockNewClusterSelection(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()

	// Stub refresh wiring so selection updates exercise the in-place path.
	app.refreshCtx = context.Background()
	app.refreshHTTPServer = &http.Server{}
	app.refreshAggregates = &refreshAggregateHandlers{}

	app.availableKubeconfigs = []KubeconfigInfo{
		{Name: "config-a", Path: "/path/a", Context: "ctx-a"},
		{Name: "config-b", Path: "/path/b", Context: "ctx-b"},
	}
	selectionA := kubeconfigSelection{Path: "/path/a", Context: "ctx-a"}
	selectionB := kubeconfigSelection{Path: "/path/b", Context: "ctx-b"}
	clusterA := app.clusterMetaForSelection(selectionA).ID
	clusterB := app.clusterMetaForSelection(selectionB).ID

	// Set up cluster A with authFailedOnInit=true (credential check failed during client init).
	// Set up cluster B as a healthy cluster that we're trying to add.
	app.selectedKubeconfigs = []string{selectionA.String()}
	app.clusterClients = map[string]*clusterClients{
		clusterA: {
			meta:              ClusterMeta{ID: clusterA, Name: "ctx-a"},
			kubeconfigPath:    selectionA.Path,
			kubeconfigContext: selectionA.Context,
			client:            cgofake.NewClientset(),
			authFailedOnInit:  true, // Auth failed during pre-flight check
		},
		clusterB: {
			meta:              ClusterMeta{ID: clusterB, Name: "ctx-b"},
			kubeconfigPath:    selectionB.Path,
			kubeconfigContext: selectionB.Context,
			client:            cgofake.NewClientset(),
		},
	}

	// Cluster A has NO subsystem because auth failed on init.
	app.refreshSubsystems = map[string]*system.Subsystem{}

	// Track whether the subsystem builder was called for each cluster.
	builderCalls := make(map[string]bool)
	originalBuilder := newRefreshSubsystemWithServices
	newRefreshSubsystemWithServices = func(cfg system.Config) (*system.Subsystem, error) {
		builderCalls[cfg.ClusterID] = true
		return &system.Subsystem{}, nil
	}
	t.Cleanup(func() { newRefreshSubsystemWithServices = originalBuilder })

	// Add cluster B while cluster A has authFailedOnInit=true.
	err := app.SetSelectedKubeconfigs([]string{selectionA.String(), selectionB.String()})
	require.NoError(t, err, "Adding healthy cluster B should succeed even when cluster A has authFailedOnInit")

	// Verify cluster B got a subsystem created.
	require.True(t, builderCalls[clusterB], "Subsystem builder should be called for healthy cluster B")

	// Verify cluster A did NOT get a subsystem created.
	require.False(t, builderCalls[clusterA], "Subsystem builder should NOT be called for authFailedOnInit cluster A")
}

func TestSetSelectedKubeconfigsRapidChurnLeavesConsistentClusterState(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()

	// Stub refresh wiring so selection updates exercise in-place updates only.
	app.refreshCtx = context.Background()
	app.refreshHTTPServer = &http.Server{}
	app.refreshAggregates = &refreshAggregateHandlers{}

	tempDir := t.TempDir()
	kubeDir := filepath.Join(tempDir, ".kube")
	require.NoError(t, os.MkdirAll(kubeDir, 0o755))
	versionServer := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/version" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"major":"1","minor":"29","gitVersion":"v1.29.0","gitCommit":"test","gitTreeState":"clean","buildDate":"2024-01-01T00:00:00Z","goVersion":"go1.22","compiler":"gc","platform":"darwin/arm64"}`))
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("{}"))
	}))
	defer versionServer.Close()

	writeKubeconfig := func(filename, contextName string) string {
		configPath := filepath.Join(kubeDir, filename)
		kubeconfigContent := fmt.Sprintf(`apiVersion: v1
clusters:
- cluster:
    insecure-skip-tls-verify: true
    server: %s
  name: test-cluster
contexts:
- context:
    cluster: test-cluster
    user: test-user
  name: %s
current-context: %s
kind: Config
preferences: {}
users:
- name: test-user
  user:
    token: test-token
`, versionServer.URL, contextName, contextName)
		require.NoError(t, os.WriteFile(configPath, []byte(kubeconfigContent), 0o644))
		return configPath
	}

	configPathA := writeKubeconfig("config-a", "ctx-a")
	configPathB := writeKubeconfig("config-b", "ctx-b")
	configPathC := writeKubeconfig("config-c", "ctx-c")

	app.availableKubeconfigs = []KubeconfigInfo{
		{Name: "config-a", Path: configPathA, Context: "ctx-a"},
		{Name: "config-b", Path: configPathB, Context: "ctx-b"},
		{Name: "config-c", Path: configPathC, Context: "ctx-c"},
	}
	selectionA := kubeconfigSelection{Path: configPathA, Context: "ctx-a"}
	selectionB := kubeconfigSelection{Path: configPathB, Context: "ctx-b"}
	selectionC := kubeconfigSelection{Path: configPathC, Context: "ctx-c"}
	clusterB := app.clusterMetaForSelection(selectionB).ID
	clusterC := app.clusterMetaForSelection(selectionC).ID

	app.refreshSubsystems = map[string]*system.Subsystem{}

	originalBuilder := newRefreshSubsystemWithServices
	newRefreshSubsystemWithServices = func(system.Config) (*system.Subsystem, error) {
		return &system.Subsystem{}, nil
	}
	t.Cleanup(func() { newRefreshSubsystemWithServices = originalBuilder })

	require.NoError(t, app.SetSelectedKubeconfigs([]string{selectionA.String()}))
	require.NoError(t, app.SetSelectedKubeconfigs([]string{selectionA.String(), selectionB.String()}))
	require.NoError(t, app.SetSelectedKubeconfigs([]string{selectionB.String()}))
	require.NoError(t, app.SetSelectedKubeconfigs([]string{selectionB.String(), selectionC.String()}))

	require.Equal(t, []string{selectionB.String(), selectionC.String()}, app.GetSelectedKubeconfigs())
	require.GreaterOrEqual(t, app.selectionGeneration.Load(), uint64(4))

	app.clusterClientsMu.Lock()
	clusterClientIDs := make([]string, 0, len(app.clusterClients))
	for clusterID := range app.clusterClients {
		clusterClientIDs = append(clusterClientIDs, clusterID)
	}
	app.clusterClientsMu.Unlock()
	require.ElementsMatch(t, []string{clusterB, clusterC}, clusterClientIDs)

	refreshSubsystemIDs := make([]string, 0, len(app.refreshSubsystems))
	for clusterID := range app.refreshSubsystems {
		refreshSubsystemIDs = append(refreshSubsystemIDs, clusterID)
	}
	require.ElementsMatch(t, []string{clusterB, clusterC}, refreshSubsystemIDs)
}

func TestSetSelectedKubeconfigsRemovesClusterRuntimeStateOnChurn(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	// Keep selection updates on the in-place refresh reconciliation path.
	app.refreshCtx = context.Background()
	app.refreshHTTPServer = &http.Server{}
	app.refreshAggregates = &refreshAggregateHandlers{}

	selectionA := kubeconfigSelection{Path: "/path/a", Context: "ctx-a"}
	selectionB := kubeconfigSelection{Path: "/path/b", Context: "ctx-b"}

	app.availableKubeconfigs = []KubeconfigInfo{
		{Name: "config-a", Path: selectionA.Path, Context: selectionA.Context},
		{Name: "config-b", Path: selectionB.Path, Context: selectionB.Context},
	}
	clusterA := app.clusterMetaForSelection(selectionA).ID
	clusterB := app.clusterMetaForSelection(selectionB).ID
	app.selectedKubeconfigs = []string{selectionA.String(), selectionB.String()}
	app.clusterClients = map[string]*clusterClients{
		clusterA: {
			meta:              ClusterMeta{ID: clusterA, Name: "ctx-a"},
			kubeconfigPath:    selectionA.Path,
			kubeconfigContext: selectionA.Context,
			client:            cgofake.NewClientset(),
		},
		clusterB: {
			meta:              ClusterMeta{ID: clusterB, Name: "ctx-b"},
			kubeconfigPath:    selectionB.Path,
			kubeconfigContext: selectionB.Context,
			client:            cgofake.NewClientset(),
		},
	}
	app.refreshSubsystems = map[string]*system.Subsystem{
		clusterA: {},
		clusterB: {},
	}

	doneA := make(chan struct{})
	close(doneA)
	doneB := make(chan struct{})
	close(doneB)
	canceledA := false
	canceledB := false
	app.objectCatalogEntries = map[string]*objectCatalogEntry{
		clusterA: {
			done:   doneA,
			cancel: func() { canceledA = true },
			meta:   ClusterMeta{ID: clusterA, Name: "ctx-a"},
		},
		clusterB: {
			done:   doneB,
			cancel: func() { canceledB = true },
			meta:   ClusterMeta{ID: clusterB, Name: "ctx-b"},
		},
	}

	app.shellSessions = map[string]*shellSession{
		"shell-a": {id: "shell-a", clusterID: clusterA},
		"shell-b": {id: "shell-b", clusterID: clusterB},
	}
	app.portForwardSessions = map[string]*portForwardSessionInternal{
		"pf-a": {
			PortForwardSession: PortForwardSession{
				ID:        "pf-a",
				ClusterID: clusterA,
			},
			stopChan: make(chan struct{}),
		},
		"pf-b": {
			PortForwardSession: PortForwardSession{
				ID:        "pf-b",
				ClusterID: clusterB,
			},
			stopChan: make(chan struct{}),
		},
	}

	require.NoError(t, app.SetSelectedKubeconfigs([]string{selectionB.String()}))

	require.Equal(t, []string{selectionB.String()}, app.GetSelectedKubeconfigs())

	app.clusterClientsMu.Lock()
	_, hasAClients := app.clusterClients[clusterA]
	_, hasBClients := app.clusterClients[clusterB]
	app.clusterClientsMu.Unlock()
	require.False(t, hasAClients, "removed cluster clients should be dropped")
	require.True(t, hasBClients, "remaining cluster clients should stay active")

	_, hasASubsystem := app.refreshSubsystems[clusterA]
	_, hasBSubsystem := app.refreshSubsystems[clusterB]
	require.False(t, hasASubsystem, "removed cluster refresh subsystem should be removed")
	require.True(t, hasBSubsystem, "remaining cluster refresh subsystem should stay active")

	app.objectCatalogMu.Lock()
	_, hasACatalog := app.objectCatalogEntries[clusterA]
	_, hasBCatalog := app.objectCatalogEntries[clusterB]
	app.objectCatalogMu.Unlock()
	require.False(t, hasACatalog, "removed cluster object catalog entry should be removed")
	require.True(t, hasBCatalog, "remaining cluster object catalog entry should stay active")
	require.True(t, canceledA, "removed cluster object catalog should be canceled")
	require.False(t, canceledB, "remaining cluster object catalog should not be canceled")

	require.Equal(t, 0, app.GetClusterShellSessionCount(clusterA))
	require.Equal(t, 1, app.GetClusterShellSessionCount(clusterB))
	require.Equal(t, 0, app.GetClusterPortForwardCount(clusterA))
	require.Equal(t, 1, app.GetClusterPortForwardCount(clusterB))
}

func TestSetSelectedKubeconfigsKeepsResponseCacheClusterScopedDuringChurn(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	// Keep selection updates on the in-place refresh reconciliation path.
	app.refreshCtx = context.Background()
	app.refreshHTTPServer = &http.Server{}
	app.refreshAggregates = &refreshAggregateHandlers{}
	app.responseCache = newResponseCache(time.Minute, 64)

	selectionA := kubeconfigSelection{Path: "/path/a", Context: "ctx-a"}
	selectionB := kubeconfigSelection{Path: "/path/b", Context: "ctx-b"}

	app.availableKubeconfigs = []KubeconfigInfo{
		{Name: "config-a", Path: selectionA.Path, Context: selectionA.Context},
		{Name: "config-b", Path: selectionB.Path, Context: selectionB.Context},
	}
	clusterA := app.clusterMetaForSelection(selectionA).ID
	clusterB := app.clusterMetaForSelection(selectionB).ID
	app.selectedKubeconfigs = []string{selectionA.String(), selectionB.String()}
	app.clusterClients = map[string]*clusterClients{
		clusterA: {
			meta:              ClusterMeta{ID: clusterA, Name: "ctx-a"},
			kubeconfigPath:    selectionA.Path,
			kubeconfigContext: selectionA.Context,
			client:            cgofake.NewClientset(),
		},
		clusterB: {
			meta:              ClusterMeta{ID: clusterB, Name: "ctx-b"},
			kubeconfigPath:    selectionB.Path,
			kubeconfigContext: selectionB.Context,
			client:            cgofake.NewClientset(),
		},
	}
	app.refreshSubsystems = map[string]*system.Subsystem{
		clusterA: {},
		clusterB: {},
	}

	const cacheKey = "pod-detailed:default:nginx"
	app.responseCacheStore(clusterA, cacheKey, "cluster-a-value")
	app.responseCacheStore(clusterB, cacheKey, "cluster-b-value")

	require.NoError(t, app.SetSelectedKubeconfigs([]string{selectionB.String()}))

	valueB, ok := app.responseCacheLookup(clusterB, cacheKey)
	require.True(t, ok, "remaining cluster cache entry should still be available")
	require.Equal(t, "cluster-b-value", valueB)

	valueA, ok := app.responseCacheLookup(clusterA, cacheKey)
	require.True(t, ok, "removed cluster cache entry should stay cluster-scoped")
	require.Equal(t, "cluster-a-value", valueA)

	_, ok = app.responseCacheLookup("cluster-c", cacheKey)
	require.False(t, ok, "other clusters must not see cached values for different cluster IDs")
}
