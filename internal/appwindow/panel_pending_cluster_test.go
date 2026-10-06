package appwindow

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend"
	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Exercise the native registry and real backend ownership/connection machinery.
// The unreachable server stays blocked until after both healthy panels open.
func TestHealthyPanelOpensWhileSiblingClusterIsStillConnecting(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", home)
	t.Setenv("APPDATA", home)
	started, ended, release := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var begin, finish sync.Once
	unblock := sync.OnceFunc(func() { close(release) })
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/slow/version" {
			begin.Do(func() { close(started) })
			defer finish.Do(func() { close(ended) })
			select {
			case <-r.Context().Done():
				return
			case <-release:
			}
		}
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "/version") {
			_, _ = w.Write([]byte(`{"major":"1","minor":"30"}`))
		} else {
			_, _ = w.Write([]byte(`{"kind":"APIGroupList","apiVersion":"v1","groups":[]}`))
		}
	}))
	defer server.Close()
	runtime := backend.NewApplicationRuntime(nil)
	defer func() { unblock(); require.NoError(t, runtime.Lifecycle.ServiceShutdown()) }()
	registry := NewRegistry(application.New(application.Options{}), runtime.Lifecycle)
	registry.emitWindowEvent = func(string, string, any) bool { return true }
	path := filepath.Join(home, "config")
	config := fmt.Sprintf(`apiVersion: v1
kind: Config
current-context: healthy
clusters:
- name: healthy
  cluster:
    server: %s/healthy
- name: slow
  cluster:
    server: %s/slow
contexts:
- name: healthy
  context:
    cluster: healthy
    user: test
- name: slow
  context:
    cluster: slow
    user: test
users:
- name: test
  user:
    token: fixture-token
`, server.URL, server.URL)
	require.NoError(t, os.WriteFile(path, []byte(config), 0o600))
	require.NoError(t, runtime.Workspace.SetKubeconfigSearchPaths([]string{path}))
	window := registry.Create(true).Name()
	healthy, slow := "config:healthy", "config:slow"
	result := runtime.Workspace.ApplyClusterWorkspace(backend.ClusterWorkspaceCommand{
		WindowID: window, UpdateSelectedKubeconfigs: true,
		SelectedKubeconfigs: []string{path + ":healthy"}, VisibleClusterID: healthy,
	})
	require.Empty(t, result.Error)
	require.Eventually(t, func() bool {
		diagnostics, err := runtime.Workspace.GetSelectionDiagnostics()
		return err == nil && diagnostics.ActiveQueueDepth == 0
	}, time.Second, time.Millisecond)
	result = runtime.Workspace.ApplyClusterWorkspace(backend.ClusterWorkspaceCommand{
		WindowID: window, UpdateSelectedKubeconfigs: true,
		SelectedKubeconfigs: []string{path + ":healthy", path + ":slow"}, VisibleClusterID: healthy,
	})
	require.Empty(t, result.Error)
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("unreachable cluster did not start connecting")
	}
	for _, name := range []string{"first", "second"} {
		tab := panelwindow.TabSnapshot{
			Kind: panelwindow.TabKindObject, PanelID: "obj:" + healthy + ":ConfigMap:default:" + name, ActiveView: "yaml",
			ObjectRef: panelwindow.ObjectReference{ClusterID: healthy, Version: "v1", Kind: "ConfigMap", Namespace: "default", Name: name},
		}
		type outcome struct {
			result panelwindow.PanelOpenResult
			err    error
		}
		opened := make(chan outcome, 1)
		go func() { result, err := registry.OpenPanelWorkspaceObject(window, tab); opened <- outcome{result, err} }()
		select {
		case got := <-opened:
			require.NoError(t, got.err)
			require.True(t, got.result.Render, "the renderer needs admission while the other cluster is still connecting")
			require.Equal(t, tab.ObjectRef, got.result.Panel.Tab.ObjectRef)
			require.Equal(t, panelwindow.PanelLocationDocked, got.result.Panel.Location.Kind)
		case <-time.After(time.Second):
			t.Error("healthy resource panel waited for the unreachable cluster")
			unblock()
			<-opened
			return
		}
	}
	require.Len(t, registry.workspace.Snapshot(healthy).Panels, 2)
	require.Equal(t, []string{healthy, slow}, runtime.Workspace.WindowClusterIDs(window))
	select {
	case <-ended:
		t.Fatal("opening a healthy panel cancelled the sibling connection")
	default:
	}
	allowed, err := registry.CloseClusterView(context.Background(), window, slow)
	require.NoError(t, err)
	require.True(t, allowed)
	require.Len(t, registry.workspace.Snapshot(healthy).Panels, 2)
}
