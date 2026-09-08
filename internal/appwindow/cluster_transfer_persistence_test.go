package appwindow

import (
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

func TestFailedClusterWindowCreationPreservesSelectionAfterLastPanelCloses(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", home)
	t.Setenv("APPDATA", home)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()
	runtime := backend.NewApplicationRuntime(nil)
	t.Cleanup(func() { require.NoError(t, runtime.Lifecycle.ServiceShutdown()) })
	registry := NewRegistry(application.New(application.Options{}), runtime.Lifecycle)
	registry.clusterTransferTimeout = 0
	path := filepath.Join(home, "config")
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
	snapshot := validPanelGroupSnapshot()
	snapshot.SourceWindowName = source
	snapshot.ClusterID = clusterID
	snapshot.Tabs[0].ObjectRef.ClusterID = clusterID
	panel := livePanelWindowForTabTransfer(t, registry.panels, snapshot)
	require.NoError(t, runtime.Workspace.RetainPanelCluster(panel.WindowName, clusterID))
	registry.emitWindowEvent = func(string, string, any) bool { return true }
	registry.newWindow = func(application.WebviewWindowOptions) *application.WebviewWindow { return nil }
	request := panelwindow.ClusterTabTransferRequest{TransferID: "failed-creation", SourceWindowName: source, ClusterID: clusterID}
	require.NoError(t, registry.RequestClusterTabTransfer(source, request))
	require.ErrorContains(t, registry.AcceptClusterTabTransfer(source, request.TransferID,
		panelwindow.ClusterViewSnapshot{SchemaVersion: 1, ViewState: "{}"}), "create cluster transfer destination")
	require.Equal(t, []string{source}, registry.lifecycle.Names())
	require.Equal(t, []string{clusterID}, runtime.Workspace.WindowClusterIDs(source))
	registry.closeWindow = func(name string) bool {
		if name == source {
			registry.handleClosing(nil, name)
		}
		return true
	}
	require.NoError(t, registry.AcknowledgeWorkspaceWindowClose(source))
	require.Equal(t, PanelWindowStateLive, registry.panels.State(panel.WindowName))
	require.NoError(t, registry.AcknowledgePanelWindowClose(panel.WindowName))
	require.Empty(t, runtime.Workspace.GetSelectedKubeconfigs())
	reloaded := backend.NewApplicationRuntime(nil)
	t.Cleanup(func() { require.NoError(t, reloaded.Lifecycle.ServiceShutdown()) })
	_, err := reloaded.Preferences.EnsureLoadedForStartup()
	require.NoError(t, err)
	require.Equal(t, []string{selection}, reloaded.Preferences.SelectedKubeconfigs())
}
