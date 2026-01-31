package backend

import (
	"context"
	"net/http"
	"testing"

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
