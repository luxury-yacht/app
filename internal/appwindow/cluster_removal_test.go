package appwindow

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestKubeconfigPruneDisposesItsNativePanelWorkspace(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", home)
	t.Setenv("APPDATA", home)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusUnauthorized) }))
	defer server.Close()
	runtime := backend.NewApplicationRuntime(nil)
	t.Cleanup(func() { require.NoError(t, runtime.Lifecycle.ServiceShutdown()) })
	registry := NewRegistry(application.New(application.Options{}), runtime.Lifecycle)
	path := filepath.Join(home, "config")
	config := fmt.Sprintf("apiVersion: v1\nkind: Config\ncurrent-context: prod\nclusters:\n- name: prod\n  cluster:\n    server: %s\n    insecure-skip-tls-verify: true\ncontexts:\n- name: prod\n  context:\n    cluster: prod\n    user: test\nusers:\n- name: test\n  user:\n    token: fixture-token\n", server.URL)
	require.NoError(t, os.WriteFile(path, []byte(config), 0o600))
	require.NoError(t, runtime.Workspace.SetKubeconfigSearchPaths([]string{path}))
	app := registry.Create(true)
	result := runtime.Workspace.ApplyClusterWorkspace(backend.ClusterWorkspaceCommand{WindowID: app.Name(), UpdateSelectedKubeconfigs: true, SelectedKubeconfigs: []string{path + ":prod"}})
	require.Equal(t, []string{path + ":prod"}, result.State.SelectedKubeconfigs)
	clusterID := runtime.Workspace.WindowClusterIDs(app.Name())[0]
	snapshot := validPanelGroupSnapshot()
	snapshot.SourceWindowName = app.Name()
	snapshot.ClusterID = clusterID
	snapshot.Tabs[0].ObjectRef.ClusterID = clusterID
	native := livePanelWindowForTabTransfer(t, registry.panels, snapshot)
	snapshot.SourceWindowName = native.WindowName
	registry.emitWindowEvent = func(string, string, any) bool { return true }
	require.NoError(t, runtime.Workspace.RetainPanelCluster(native.WindowName, clusterID))
	require.NoError(t, registry.UpdatePanelWindowSnapshot(native.WindowName, snapshot))
	closed := make(chan string, 1)
	registry.closeWindow = func(name string) bool { closed <- name; return true }
	require.NoError(t, runtime.Workspace.SetKubeconfigSearchPaths([]string{t.TempDir()}))
	require.Empty(t, runtime.Workspace.GetSelectedKubeconfigs())
	require.Empty(t, registry.workspace.Snapshot(clusterID).Panels)
	select {
	case name := <-closed:
		require.Equal(t, native.WindowName, name)
	case <-time.After(time.Second):
		t.Fatal("kubeconfig removal left its native panel window alive")
	}
	require.Eventually(t, func() bool { _, err := registry.panels.Descriptor(native.WindowName); return err != nil }, time.Second, time.Millisecond)
	require.Empty(t, registry.workspace.Snapshot(clusterID).Panels)
}
