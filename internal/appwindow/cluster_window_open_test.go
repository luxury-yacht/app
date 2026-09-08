package appwindow

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/luxury-yacht/app/backend"
	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestOpenClusterWindowPreservesSourceAndSharedPanels(t *testing.T) {
	for _, clusters := range [][]string{{"cluster-1"}, {"cluster-1", "cluster-2"}} {
		t.Run(clusters[len(clusters)-1], func(t *testing.T) {
			backend := &recordingLifecycleBackend{windowClusters: map[string][]string{}}
			registry := NewRegistry(application.New(application.Options{}), backend)
			source := registry.Create(true).Name()
			backend.windowClusters[source] = clusters
			tab := validPanelGroupSnapshot().Tabs[0]
			groups := []panelwindow.WorkspaceGroup{{ClusterID: "cluster-1", GroupID: "right", Tabs: []panelwindow.TabSnapshot{tab}, ActivePanelID: tab.PanelID}}
			require.NoError(t, registry.PublishDockedPanels(source, groups))
			before := registry.workspace.Snapshot("cluster-1")
			create := registry.newWindow
			var target string
			registry.newWindow = func(options application.WebviewWindowOptions) *application.WebviewWindow {
				target = options.Name
				require.Equal(t, []string{"cluster-1"}, backend.WindowClusterIDs(target), "seed the clicked cluster before renderer startup")
				require.Equal(t, clusters, backend.WindowClusterIDs(source))
				return create(options)
			}
			registry.closeWindow = func(string) bool { t.Fatal("opening another view must not close a window"); return false }
			require.NoError(t, registry.OpenClusterWindow(source, "cluster-1"))
			require.NotEmpty(t, target)
			require.ElementsMatch(t, []string{source, target}, registry.lifecycle.Names())
			require.Equal(t, clusters, backend.WindowClusterIDs(source))
			require.Equal(t, before, registry.workspace.Snapshot("cluster-1"))
			require.Empty(t, registry.clusterTransfers, "opening another view must not leave a pending transfer")
		})
	}
}

func TestOpenClusterWindowRejectsStaleOrClosingSource(t *testing.T) {
	backend := &recordingLifecycleBackend{windowClusters: map[string][]string{}}
	registry := NewRegistry(application.New(application.Options{}), backend)
	source := registry.Create(true).Name()
	backend.windowClusters[source] = []string{"cluster-1"}
	registry.newWindow = func(application.WebviewWindowOptions) *application.WebviewWindow {
		t.Fatal("invalid source must not create a window")
		return nil
	}
	require.Error(t, registry.OpenClusterWindow("missing", "cluster-1"))
	require.Error(t, registry.OpenClusterWindow(source, "cluster-2"))
	pending, err := registry.beginClusterPanelClose(source, "cluster-1")
	require.NoError(t, err)
	require.Error(t, registry.OpenClusterWindow(source, "cluster-1"))
	registry.finishClusterPanelClose(pending)
	require.Equal(t, []string{source}, registry.lifecycle.Names())
}

func TestOpenClusterWindowExcludesCloseWhileCreatingTarget(t *testing.T) {
	backend := &recordingLifecycleBackend{windowClusters: map[string][]string{}}
	registry := NewRegistry(application.New(application.Options{}), backend)
	source := registry.Create(true).Name()
	backend.windowClusters[source] = []string{"cluster-1"}
	create := registry.newWindow
	registry.newWindow = func(options application.WebviewWindowOptions) *application.WebviewWindow {
		allowed, err := registry.CloseClusterView(context.Background(), source, "cluster-1")
		require.ErrorContains(t, err, "pending view transfer")
		require.False(t, allowed)
		return create(options)
	}
	require.NoError(t, registry.OpenClusterWindow(source, "cluster-1"))
	allowed, err := registry.CloseClusterView(context.Background(), source, "cluster-1")
	require.NoError(t, err)
	require.True(t, allowed, "close admission must resume after creation")
}

func TestOpenClusterWindowCreationFailureReleasesTargetAndAllowsRetry(t *testing.T) {
	backend := &recordingLifecycleBackend{windowClusters: map[string][]string{}}
	registry := NewRegistry(application.New(application.Options{}), backend)
	source := registry.Create(true).Name()
	backend.windowClusters[source] = []string{"cluster-1"}
	create := registry.newWindow
	var failedTarget string
	registry.newWindow = func(options application.WebviewWindowOptions) *application.WebviewWindow {
		failedTarget = options.Name
		return nil
	}
	require.ErrorContains(t, registry.OpenClusterWindow(source, "cluster-1"), "create cluster transfer destination")
	require.Equal(t, failedTarget, backend.releasedWindow)
	require.Empty(t, backend.WindowClusterIDs(failedTarget))
	require.Equal(t, []string{source}, registry.lifecycle.Names())
	require.Equal(t, []string{"cluster-1"}, backend.WindowClusterIDs(source))
	require.Empty(t, registry.clusterTransfers)
	registry.newWindow = create
	require.NoError(t, registry.OpenClusterWindow(source, "cluster-1"))
}

type failedClusterWindowBackend struct{ recordingLifecycleBackend }

func (*failedClusterWindowBackend) StageClusterViewTransfer(string, string, string) (bool, error) {
	return false, errors.New("source selection changed")
}

func TestOpenClusterWindowRevalidatesSourceAtSelectionAdmission(t *testing.T) {
	backend := &failedClusterWindowBackend{}
	registry := NewRegistry(application.New(application.Options{}), backend)
	source := registry.Create(true).Name()
	registry.newWindow = func(application.WebviewWindowOptions) *application.WebviewWindow {
		t.Fatal("failed admission must not create a window")
		return nil
	}
	require.ErrorContains(t, registry.OpenClusterWindow(source, "cluster-1"), "source selection changed")
	require.Equal(t, []string{source}, registry.lifecycle.Names())
	require.Empty(t, registry.clusterTransfers)
}

func TestOpenClusterWindowRejectsAnExistingTransferAndAllowsRetry(t *testing.T) {
	registry := NewRegistry(application.New(application.Options{}), &recordingLifecycleBackend{})
	source := registry.Create(true).Name()
	registry.emitWindowEvent = func(string, string, any) bool { return true }
	request := panelwindow.ClusterTabTransferRequest{TransferID: "pending-move", SourceWindowName: source, ClusterID: "cluster-1"}
	require.NoError(t, registry.RequestClusterTabTransfer(source, request))
	require.ErrorContains(t, registry.OpenClusterWindow(source, "cluster-1"), "pending view transfer")
	require.Equal(t, []string{source}, registry.lifecycle.Names())
	require.NoError(t, registry.FailClusterTabTransfer(source, request.TransferID))
	require.NoError(t, registry.OpenClusterWindow(source, "cluster-1"))
}

func TestClusterWindowActionsPreserveMoveAdmissionAndFailureCleanup(t *testing.T) {
	registry := NewRegistry(application.New(application.Options{}), &recordingLifecycleBackend{})
	source := registry.Create(true).Name()
	request := panelwindow.ClusterTabTransferRequest{TransferID: "unavailable", SourceWindowName: source, ClusterID: "cluster-1"}
	registry.emitWindowEvent = func(string, string, any) bool { return false }
	require.ErrorContains(t, registry.RequestClusterTabTransfer(source, request), "source is not available")
	require.Empty(t, registry.clusterTransfers)
	require.True(t, registry.windowHasCluster(source, "cluster-1"))
	registry.emitWindowEvent = func(string, string, any) bool { return true }
	request.TransferID = "pending"
	require.NoError(t, registry.RequestClusterTabTransfer(source, request))
	require.ErrorContains(t, registry.RequestClusterTabTransfer(source, request), "already used")
	other := request
	other.TransferID = "another"
	require.ErrorContains(t, registry.RequestClusterTabTransfer(source, other), "pending view transfer")
	require.NoError(t, registry.FailClusterTabTransfer(source, request.TransferID))
	require.NoError(t, registry.RequestClusterTabTransfer(source, other))
	require.NoError(t, registry.FailClusterTabTransfer(source, other.TransferID))
	require.Equal(t, []string{source}, registry.lifecycle.Names())
}

func TestOpenClusterWindowKeepsRealWorkspaceSelectionAndPanelOwnership(t *testing.T) {
	configRoot := t.TempDir()
	t.Setenv("HOME", configRoot)
	t.Setenv("XDG_CONFIG_HOME", configRoot)
	t.Setenv("APPDATA", configRoot)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()
	runtime := backend.NewApplicationRuntime(nil)
	t.Cleanup(func() { require.NoError(t, runtime.Lifecycle.ServiceShutdown()) })
	registry := NewRegistry(application.New(application.Options{}), runtime.Lifecycle)
	path := filepath.Join(configRoot, "config")
	config := fmt.Sprintf("apiVersion: v1\nkind: Config\ncurrent-context: prod\nclusters:\n- name: prod\n  cluster:\n    server: %s\n    insecure-skip-tls-verify: true\ncontexts:\n- name: prod\n  context:\n    cluster: prod\n    user: test\nusers:\n- name: test\n  user:\n    token: fixture-token\n", server.URL)
	require.NoError(t, os.WriteFile(path, []byte(config), 0o600))
	require.NoError(t, runtime.Workspace.SetKubeconfigSearchPaths([]string{path}))
	source := registry.Create(true).Name()
	selection := path + ":prod"
	result := runtime.Workspace.ApplyClusterWorkspace(backend.ClusterWorkspaceCommand{
		WindowID: source, UpdateSelectedKubeconfigs: true, SelectedKubeconfigs: []string{selection},
	})
	require.Equal(t, []string{selection}, result.State.SelectedKubeconfigs)
	clusterID := runtime.Workspace.WindowClusterIDs(source)[0]
	tab := validPanelGroupSnapshot().Tabs[0]
	tab.ObjectRef.ClusterID = clusterID
	groups := []panelwindow.WorkspaceGroup{{ClusterID: clusterID, GroupID: "right", Tabs: []panelwindow.TabSnapshot{tab}, ActivePanelID: tab.PanelID}}
	require.NoError(t, registry.PublishDockedPanels(source, groups))
	before := runtime.Workspace.PanelWorkspaceDirectory().Snapshot(clusterID)
	create := registry.newWindow
	var target string
	registry.newWindow = func(options application.WebviewWindowOptions) *application.WebviewWindow {
		target = options.Name
		state := runtime.Workspace.GetClusterWorkspaceStateForWindow(target)
		require.Equal(t, []string{selection}, state.SelectedKubeconfigs)
		return create(options)
	}
	require.NoError(t, registry.OpenClusterWindow(source, clusterID))
	require.Equal(t, []string{clusterID}, runtime.Workspace.WindowClusterIDs(source))
	require.Equal(t, []string{clusterID}, runtime.Workspace.WindowClusterIDs(target))
	require.Equal(t, []string{selection}, runtime.Workspace.GetSelectedKubeconfigs())
	require.Equal(t, before, runtime.Workspace.PanelWorkspaceDirectory().Snapshot(clusterID))
	allowed, err := registry.CloseClusterView(context.Background(), target, clusterID)
	require.NoError(t, err)
	require.True(t, allowed)
	require.Empty(t, runtime.Workspace.WindowClusterIDs(target))
	require.Equal(t, []string{clusterID}, runtime.Workspace.WindowClusterIDs(source))
	require.Equal(t, []string{selection}, runtime.Workspace.GetSelectedKubeconfigs())
	require.Equal(t, before, runtime.Workspace.PanelWorkspaceDirectory().Snapshot(clusterID))
}
