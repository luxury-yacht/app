package backend

import (
	"context"
	"net/http"
	"testing"

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
