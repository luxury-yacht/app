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

func TestUpdateRefreshSubsystemSelectionsValidatesReceiverAndAllowsEmptySelection(t *testing.T) {
	var nilRefresh *RefreshCoordinator
	require.EqualError(t, nilRefresh.updateRefreshSubsystemSelections(nil), "refresh coordinator is nil")

	refreshCoordinator := newRefreshCoordinator(RefreshCoordinatorDependencies{})
	require.NoError(t, refreshCoordinator.updateRefreshSubsystemSelections(nil))
}

func TestApplyRefreshSelectionUpdateReportsClustersWhenRuntimeUnavailable(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	app.Refresh.stopRefreshRuntimeContext()

	err := app.Refresh.applyRefreshSelectionUpdate(refreshSelectionPlan{
		clusterOrder: []string{"cluster-a", "cluster-b"},
	}, refreshSelectionUpdate{})
	require.EqualError(t, err,
		"refresh runtime unavailable while applying selection update for clusters cluster-a, cluster-b")
}

func TestSetSelectedKubeconfigsKeepsRefreshServerOnSelectionChange(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())

	// Stub refresh wiring so selection updates exercise the in-place path.
	setRefreshRuntimeContextForTest(app.Refresh, context.Background())
	setRefreshServiceReadyForTest(app.Refresh)
	app.Refresh.refreshAggregates.Store(&refreshAggregateHandlers{})

	app.ClusterRuntime.availableKubeconfigs = []KubeconfigInfo{
		{Name: "config-a", Path: "/path/a", Context: "ctx-a"},
		{Name: "config-b", Path: "/path/b", Context: "ctx-b"},
	}
	selectionA := kubeconfigSelection{Path: "/path/a", Context: "ctx-a"}
	selectionB := kubeconfigSelection{Path: "/path/b", Context: "ctx-b"}
	clusterA := app.ClusterRuntime.clusterMetaForSelection(selectionA).ID
	clusterB := app.ClusterRuntime.clusterMetaForSelection(selectionB).ID

	app.Workspace.selectedKubeconfigs = []string{selectionA.String()}
	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
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

	originalService := app.Refresh.refreshService.Load()
	existingSubsystem := &system.Subsystem{}
	app.Refresh.refreshSubsystems = map[string]*system.Subsystem{clusterA: existingSubsystem}

	originalBuilder := newRefreshSubsystemWithServices
	newRefreshSubsystemWithServices = func(system.Config) (*system.Subsystem, error) {
		return &system.Subsystem{}, nil
	}
	t.Cleanup(func() { newRefreshSubsystemWithServices = originalBuilder })

	require.NoError(t, app.Workspace.SetSelectedKubeconfigs([]string{selectionA.String(), selectionB.String()}))
	require.Same(t, originalService, app.Refresh.refreshService.Load())
	require.Same(t, existingSubsystem, app.Refresh.refreshSubsystems[clusterA])
	require.NotNil(t, app.Refresh.refreshSubsystems[clusterB])

	remainingSubsystem := app.Refresh.refreshSubsystems[clusterB]
	require.NoError(t, app.Workspace.SetSelectedKubeconfigs([]string{selectionB.String()}))
	require.Same(t, originalService, app.Refresh.refreshService.Load())
	require.Equal(t, 1, len(app.Refresh.refreshSubsystems))
	require.Same(t, remainingSubsystem, app.Refresh.refreshSubsystems[clusterB])
}

// TestAuthFailedClusterDoesNotBlockNewClusterSelection verifies that when one cluster
// has an auth failure, adding a new healthy cluster still succeeds.
// This is a critical isolation test - auth failures in one cluster must NEVER
// prevent the user from opening/adding other clusters.
func TestAuthFailedClusterDoesNotBlockNewClusterSelection(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())

	// Stub refresh wiring so selection updates exercise the in-place path.
	setRefreshRuntimeContextForTest(app.Refresh, context.Background())
	setRefreshServiceReadyForTest(app.Refresh)
	app.Refresh.refreshAggregates.Store(&refreshAggregateHandlers{})

	app.ClusterRuntime.availableKubeconfigs = []KubeconfigInfo{
		{Name: "config-a", Path: "/path/a", Context: "ctx-a"},
		{Name: "config-b", Path: "/path/b", Context: "ctx-b"},
	}
	selectionA := kubeconfigSelection{Path: "/path/a", Context: "ctx-a"}
	selectionB := kubeconfigSelection{Path: "/path/b", Context: "ctx-b"}
	clusterA := app.ClusterRuntime.clusterMetaForSelection(selectionA).ID
	clusterB := app.ClusterRuntime.clusterMetaForSelection(selectionB).ID

	// Create an auth manager for cluster A that reports auth failure.
	// Set MaxAttempts to 0 to disable automatic recovery, ensuring the auth manager
	// stays in StateInvalid after ReportFailure is called.
	authMgrA := authstate.New(authstate.Config{
		MaxAttempts:   0, // Disable auto-recovery so state stays Invalid
		OnStateChange: func(authstate.State, authstate.FailureDiagnostic) {},
	})
	// Force auth manager into invalid state by reporting a failure.
	// With MaxAttempts=0, this immediately transitions to StateInvalid.
	authMgrA.ReportFailure("test auth failure")

	// Set up cluster A as having auth failure (no subsystem, auth manager in failed state).
	// Set up cluster B as a healthy cluster that we're trying to add.
	app.Workspace.selectedKubeconfigs = []string{selectionA.String()}
	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
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
	app.Refresh.refreshSubsystems = map[string]*system.Subsystem{}

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
	err := app.Workspace.SetSelectedKubeconfigs([]string{selectionA.String(), selectionB.String()})
	require.NoError(t, err, "Adding healthy cluster B should succeed even when cluster A has auth failure")

	// Verify cluster B got a subsystem created.
	require.True(t, builderCalls[clusterB], "Subsystem builder should be called for healthy cluster B")

	// Verify cluster A did NOT get a subsystem created (it has auth failure).
	require.False(t, builderCalls[clusterA], "Subsystem builder should NOT be called for auth-failed cluster A")

	// Verify cluster B has a subsystem but cluster A does not.
	require.NotNil(t, app.Refresh.refreshSubsystems[clusterB], "Cluster B should have a subsystem")
	require.Nil(t, app.Refresh.refreshSubsystems[clusterA], "Cluster A should NOT have a subsystem (auth failed)")
}

// TestAuthFailedOnInitClusterDoesNotBlockNewClusterSelection verifies that when one cluster
// has authFailedOnInit=true, adding a new healthy cluster still succeeds.
func TestAuthFailedOnInitClusterDoesNotBlockNewClusterSelection(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())

	// Stub refresh wiring so selection updates exercise the in-place path.
	setRefreshRuntimeContextForTest(app.Refresh, context.Background())
	setRefreshServiceReadyForTest(app.Refresh)
	app.Refresh.refreshAggregates.Store(&refreshAggregateHandlers{})

	app.ClusterRuntime.availableKubeconfigs = []KubeconfigInfo{
		{Name: "config-a", Path: "/path/a", Context: "ctx-a"},
		{Name: "config-b", Path: "/path/b", Context: "ctx-b"},
	}
	selectionA := kubeconfigSelection{Path: "/path/a", Context: "ctx-a"}
	selectionB := kubeconfigSelection{Path: "/path/b", Context: "ctx-b"}
	clusterA := app.ClusterRuntime.clusterMetaForSelection(selectionA).ID
	clusterB := app.ClusterRuntime.clusterMetaForSelection(selectionB).ID

	// Set up cluster A with authFailedOnInit=true (credential check failed during client init).
	// Set up cluster B as a healthy cluster that we're trying to add.
	app.Workspace.selectedKubeconfigs = []string{selectionA.String()}
	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
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
	app.Refresh.refreshSubsystems = map[string]*system.Subsystem{}

	// Track whether the subsystem builder was called for each cluster.
	builderCalls := make(map[string]bool)
	originalBuilder := newRefreshSubsystemWithServices
	newRefreshSubsystemWithServices = func(cfg system.Config) (*system.Subsystem, error) {
		builderCalls[cfg.ClusterID] = true
		return &system.Subsystem{}, nil
	}
	t.Cleanup(func() { newRefreshSubsystemWithServices = originalBuilder })

	// Add cluster B while cluster A has authFailedOnInit=true.
	err := app.Workspace.SetSelectedKubeconfigs([]string{selectionA.String(), selectionB.String()})
	require.NoError(t, err, "Adding healthy cluster B should succeed even when cluster A has authFailedOnInit")

	// Verify cluster B got a subsystem created.
	require.True(t, builderCalls[clusterB], "Subsystem builder should be called for healthy cluster B")

	// Verify cluster A did NOT get a subsystem created.
	require.False(t, builderCalls[clusterA], "Subsystem builder should NOT be called for authFailedOnInit cluster A")
}

func TestSetSelectedKubeconfigsRapidChurnLeavesConsistentClusterState(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())

	// Stub refresh wiring so selection updates exercise in-place updates only.
	setRefreshRuntimeContextForTest(app.Refresh, context.Background())
	setRefreshServiceReadyForTest(app.Refresh)
	app.Refresh.refreshAggregates.Store(&refreshAggregateHandlers{})

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

	app.ClusterRuntime.availableKubeconfigs = []KubeconfigInfo{
		{Name: "config-a", Path: configPathA, Context: "ctx-a"},
		{Name: "config-b", Path: configPathB, Context: "ctx-b"},
		{Name: "config-c", Path: configPathC, Context: "ctx-c"},
	}
	selectionA := kubeconfigSelection{Path: configPathA, Context: "ctx-a"}
	selectionB := kubeconfigSelection{Path: configPathB, Context: "ctx-b"}
	selectionC := kubeconfigSelection{Path: configPathC, Context: "ctx-c"}
	clusterB := app.ClusterRuntime.clusterMetaForSelection(selectionB).ID
	clusterC := app.ClusterRuntime.clusterMetaForSelection(selectionC).ID

	app.Refresh.refreshSubsystems = map[string]*system.Subsystem{}

	originalBuilder := newRefreshSubsystemWithServices
	newRefreshSubsystemWithServices = func(system.Config) (*system.Subsystem, error) {
		return &system.Subsystem{}, nil
	}
	t.Cleanup(func() { newRefreshSubsystemWithServices = originalBuilder })

	require.NoError(t, app.Workspace.SetSelectedKubeconfigs([]string{selectionA.String()}))
	require.NoError(t, app.Workspace.SetSelectedKubeconfigs([]string{selectionA.String(), selectionB.String()}))
	require.NoError(t, app.Workspace.SetSelectedKubeconfigs([]string{selectionB.String()}))
	require.NoError(t, app.Workspace.SetSelectedKubeconfigs([]string{selectionB.String(), selectionC.String()}))

	require.Equal(t, []string{selectionB.String(), selectionC.String()}, app.Workspace.GetSelectedKubeconfigs())
	require.GreaterOrEqual(t, app.Workspace.selectionGeneration.Load(), uint64(4))

	app.ClusterRuntime.clusterClientsMu.Lock()
	clusterClientIDs := make([]string, 0, len(app.ClusterRuntime.clusterClients))
	for clusterID := range app.ClusterRuntime.clusterClients {
		clusterClientIDs = append(clusterClientIDs, clusterID)
	}
	app.ClusterRuntime.clusterClientsMu.Unlock()
	require.ElementsMatch(t, []string{clusterB, clusterC}, clusterClientIDs)

	refreshSubsystemIDs := make([]string, 0, len(app.Refresh.refreshSubsystems))
	for clusterID := range app.Refresh.refreshSubsystems {
		refreshSubsystemIDs = append(refreshSubsystemIDs, clusterID)
	}
	require.ElementsMatch(t, []string{clusterB, clusterC}, refreshSubsystemIDs)
}

func TestSetSelectedKubeconfigsRemovesClusterRuntimeStateOnChurn(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)

	// Keep selection updates on the in-place refresh reconciliation path.
	setRefreshRuntimeContextForTest(app.Refresh, context.Background())
	setRefreshServiceReadyForTest(app.Refresh)
	app.Refresh.refreshAggregates.Store(&refreshAggregateHandlers{})

	selectionA := kubeconfigSelection{Path: "/path/a", Context: "ctx-a"}
	selectionB := kubeconfigSelection{Path: "/path/b", Context: "ctx-b"}

	app.ClusterRuntime.availableKubeconfigs = []KubeconfigInfo{
		{Name: "config-a", Path: selectionA.Path, Context: selectionA.Context},
		{Name: "config-b", Path: selectionB.Path, Context: selectionB.Context},
	}
	clusterA := app.ClusterRuntime.clusterMetaForSelection(selectionA).ID
	clusterB := app.ClusterRuntime.clusterMetaForSelection(selectionB).ID
	app.Workspace.selectedKubeconfigs = []string{selectionA.String(), selectionB.String()}
	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
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
	app.Refresh.refreshSubsystems = map[string]*system.Subsystem{
		clusterA: {},
		clusterB: {},
	}

	doneA := make(chan struct{})
	close(doneA)
	doneB := make(chan struct{})
	close(doneB)
	canceledA := false
	canceledB := false
	app.Refresh.objectCatalogEntries = map[string]*objectCatalogEntry{
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

	app.Operations.shellSessions = map[string]*shellSession{
		"shell-a": {id: "shell-a", clusterID: clusterA},
		"shell-b": {id: "shell-b", clusterID: clusterB},
	}
	app.Operations.portForwardSessions = map[string]*portForwardSessionInternal{
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
	app.Operations.registerRuntimeOperation(runtimeOperationFromShellSession(app.Operations.shellSessions["shell-a"]), func(reason string) error {
		return app.Operations.shellSessionLifecycle().closeForRuntime("shell-a", reason)
	})
	app.Operations.registerRuntimeOperation(runtimeOperationFromShellSession(app.Operations.shellSessions["shell-b"]), func(reason string) error {
		return app.Operations.shellSessionLifecycle().closeForRuntime("shell-b", reason)
	})
	app.Operations.registerRuntimeOperation(runtimeOperationFromPortForward(app.Operations.portForwardSessions["pf-a"]), func(reason string) error {
		return app.Operations.portForwardLifecycle().stopForRuntime("pf-a", reason)
	})
	app.Operations.registerRuntimeOperation(runtimeOperationFromPortForward(app.Operations.portForwardSessions["pf-b"]), func(reason string) error {
		return app.Operations.portForwardLifecycle().stopForRuntime("pf-b", reason)
	})

	require.NoError(t, app.Workspace.SetSelectedKubeconfigs([]string{selectionB.String()}))

	require.Equal(t, []string{selectionB.String()}, app.Workspace.GetSelectedKubeconfigs())

	app.ClusterRuntime.clusterClientsMu.Lock()
	_, hasAClients := app.ClusterRuntime.clusterClients[clusterA]
	_, hasBClients := app.ClusterRuntime.clusterClients[clusterB]
	app.ClusterRuntime.clusterClientsMu.Unlock()
	require.False(t, hasAClients, "removed cluster clients should be dropped")
	require.True(t, hasBClients, "remaining cluster clients should stay active")

	_, hasASubsystem := app.Refresh.refreshSubsystems[clusterA]
	_, hasBSubsystem := app.Refresh.refreshSubsystems[clusterB]
	require.False(t, hasASubsystem, "removed cluster refresh subsystem should be removed")
	require.True(t, hasBSubsystem, "remaining cluster refresh subsystem should stay active")

	app.Refresh.objectCatalogMu.Lock()
	_, hasACatalog := app.Refresh.objectCatalogEntries[clusterA]
	_, hasBCatalog := app.Refresh.objectCatalogEntries[clusterB]
	app.Refresh.objectCatalogMu.Unlock()
	require.False(t, hasACatalog, "removed cluster object catalog entry should be removed")
	require.True(t, hasBCatalog, "remaining cluster object catalog entry should stay active")
	require.True(t, canceledA, "removed cluster object catalog should be canceled")
	require.False(t, canceledB, "remaining cluster object catalog should not be canceled")

	require.Equal(t, 0, app.Operations.GetClusterShellSessionCount(clusterA))
	require.Equal(t, 1, app.Operations.GetClusterShellSessionCount(clusterB))
	require.Equal(t, 0, app.Operations.GetClusterPortForwardCount(clusterA))
	require.Equal(t, 1, app.Operations.GetClusterPortForwardCount(clusterB))

	remainingOperations := app.Operations.ListRuntimeOperations()
	require.Len(t, remainingOperations, 2)
	for _, operation := range remainingOperations {
		require.Equal(t, clusterB, operation.ClusterID, "runtime operation cleanup must stay cluster-scoped")
	}
}

func TestSetSelectedKubeconfigsClearCleansRuntimeStateForAllClusters(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)

	// Keep selection updates on the in-place refresh reconciliation path.
	setRefreshRuntimeContextForTest(app.Refresh, context.Background())
	setRefreshServiceReadyForTest(app.Refresh)
	app.Refresh.refreshAggregates.Store(&refreshAggregateHandlers{})

	selectionA := kubeconfigSelection{Path: "/path/a", Context: "ctx-a"}
	selectionB := kubeconfigSelection{Path: "/path/b", Context: "ctx-b"}

	app.ClusterRuntime.availableKubeconfigs = []KubeconfigInfo{
		{Name: "config-a", Path: selectionA.Path, Context: selectionA.Context},
		{Name: "config-b", Path: selectionB.Path, Context: selectionB.Context},
	}
	clusterA := app.ClusterRuntime.clusterMetaForSelection(selectionA).ID
	clusterB := app.ClusterRuntime.clusterMetaForSelection(selectionB).ID
	app.Workspace.selectedKubeconfigs = []string{selectionA.String(), selectionB.String()}
	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
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
	app.Refresh.refreshSubsystems = map[string]*system.Subsystem{
		clusterA: {},
		clusterB: {},
	}

	doneA := make(chan struct{})
	close(doneA)
	doneB := make(chan struct{})
	close(doneB)
	canceledA := false
	canceledB := false
	app.Refresh.objectCatalogEntries = map[string]*objectCatalogEntry{
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

	app.Operations.shellSessions = map[string]*shellSession{
		"shell-a": {id: "shell-a", clusterID: clusterA},
		"shell-b": {id: "shell-b", clusterID: clusterB},
	}
	app.Operations.portForwardSessions = map[string]*portForwardSessionInternal{
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
	app.Operations.registerRuntimeOperation(runtimeOperationFromShellSession(app.Operations.shellSessions["shell-a"]), func(reason string) error {
		return app.Operations.shellSessionLifecycle().closeForRuntime("shell-a", reason)
	})
	app.Operations.registerRuntimeOperation(runtimeOperationFromShellSession(app.Operations.shellSessions["shell-b"]), func(reason string) error {
		return app.Operations.shellSessionLifecycle().closeForRuntime("shell-b", reason)
	})
	app.Operations.registerRuntimeOperation(runtimeOperationFromPortForward(app.Operations.portForwardSessions["pf-a"]), func(reason string) error {
		return app.Operations.portForwardLifecycle().stopForRuntime("pf-a", reason)
	})
	app.Operations.registerRuntimeOperation(runtimeOperationFromPortForward(app.Operations.portForwardSessions["pf-b"]), func(reason string) error {
		return app.Operations.portForwardLifecycle().stopForRuntime("pf-b", reason)
	})

	require.NoError(t, app.Workspace.SetSelectedKubeconfigs(nil))

	require.Empty(t, app.Workspace.GetSelectedKubeconfigs())

	app.ClusterRuntime.clusterClientsMu.Lock()
	require.Empty(t, app.ClusterRuntime.clusterClients, "clearing selection should remove all cluster clients")
	app.ClusterRuntime.clusterClientsMu.Unlock()

	require.Empty(t, app.Refresh.refreshSubsystems, "clearing selection should remove all refresh subsystems")

	app.Refresh.objectCatalogMu.Lock()
	require.Empty(t, app.Refresh.objectCatalogEntries, "clearing selection should stop all object catalogs")
	app.Refresh.objectCatalogMu.Unlock()
	require.True(t, canceledA, "cluster A object catalog should be canceled")
	require.True(t, canceledB, "cluster B object catalog should be canceled")

	require.Equal(t, 0, app.Operations.GetClusterShellSessionCount(clusterA))
	require.Equal(t, 0, app.Operations.GetClusterShellSessionCount(clusterB))
	require.Equal(t, 0, app.Operations.GetClusterPortForwardCount(clusterA))
	require.Equal(t, 0, app.Operations.GetClusterPortForwardCount(clusterB))
	require.Empty(t, app.Operations.ListRuntimeOperations(), "clearing selection should remove all runtime operations")
}

func TestSetSelectedKubeconfigsKeepsResponseCacheClusterScopedDuringChurn(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)

	// Keep selection updates on the in-place refresh reconciliation path.
	setRefreshRuntimeContextForTest(app.Refresh, context.Background())
	setRefreshServiceReadyForTest(app.Refresh)
	app.Refresh.refreshAggregates.Store(&refreshAggregateHandlers{})
	app.Resources.responseCache = newResponseCache(time.Minute, 64)

	selectionA := kubeconfigSelection{Path: "/path/a", Context: "ctx-a"}
	selectionB := kubeconfigSelection{Path: "/path/b", Context: "ctx-b"}

	app.ClusterRuntime.availableKubeconfigs = []KubeconfigInfo{
		{Name: "config-a", Path: selectionA.Path, Context: selectionA.Context},
		{Name: "config-b", Path: selectionB.Path, Context: selectionB.Context},
	}
	clusterA := app.ClusterRuntime.clusterMetaForSelection(selectionA).ID
	clusterB := app.ClusterRuntime.clusterMetaForSelection(selectionB).ID
	app.Workspace.selectedKubeconfigs = []string{selectionA.String(), selectionB.String()}
	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
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
	app.Refresh.refreshSubsystems = map[string]*system.Subsystem{
		clusterA: {},
		clusterB: {},
	}

	const cacheKey = "pod-detailed:default:nginx"
	app.Resources.responseCacheStore(clusterA, cacheKey, "cluster-a-value")
	app.Resources.responseCacheStore(clusterB, cacheKey, "cluster-b-value")

	require.NoError(t, app.Workspace.SetSelectedKubeconfigs([]string{selectionB.String()}))

	valueB, ok := app.Resources.responseCacheLookup(clusterB, cacheKey)
	require.True(t, ok, "remaining cluster cache entry should still be available")
	require.Equal(t, "cluster-b-value", valueB)

	valueA, ok := app.Resources.responseCacheLookup(clusterA, cacheKey)
	require.True(t, ok, "removed cluster cache entry should stay cluster-scoped")
	require.Equal(t, "cluster-a-value", valueA)

	_, ok = app.Resources.responseCacheLookup("cluster-c", cacheKey)
	require.False(t, ok, "other clusters must not see cached values for different cluster IDs")
}
