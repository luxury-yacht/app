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

func TestApplicationQuitPreservesSelectionsFromEveryWindow(t *testing.T) {
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
	var selections []string
	var windows []string
	var paths []string
	for _, name := range []string{"first", "second"} {
		path := filepath.Join(home, name)
		config := fmt.Sprintf(`apiVersion: v1
kind: Config
current-context: %s
clusters:
- name: %s
  cluster:
    server: %s
    insecure-skip-tls-verify: true
contexts:
- name: %s
  context:
    cluster: %s
    user: test
users:
- name: test
  user:
    token: fixture-token
`, name, name, server.URL, name, name)
		require.NoError(t, os.WriteFile(path, []byte(config), 0o600))
		paths = append(paths, path)
		require.NoError(t, runtime.Workspace.SetKubeconfigSearchPaths(paths))
		window := registry.Create(len(windows) == 0)
		windows = append(windows, window.Name())
		selection := path + ":" + name
		selections = append(selections, selection)
		// Auth fails deliberately; the selected tabs must still survive quit.
		result := runtime.Workspace.ApplyClusterWorkspace(backend.ClusterWorkspaceCommand{
			WindowID: window.Name(), UpdateSelectedKubeconfigs: true,
			SelectedKubeconfigs: []string{selection},
		})
		require.Equal(t, []string{selection}, result.State.SelectedKubeconfigs, result.Error)
		registry.markWorkspaceReady(window.Name())
	}
	require.ElementsMatch(t, selections, runtime.Preferences.SelectedKubeconfigs())
	var transactionID string
	registry.emitWindowEvent = func(_ string, eventName string, payload any) bool {
		if eventName == panelwindow.ApplicationQuitPreflightRequestedEventName {
			transactionID = payload.(panelwindow.ApplicationQuitPreflightRequestedEvent).TransactionID
		}
		return true
	}
	// Exercise the real close hook and backend selection/persistence consumers.
	registry.closeWindow = func(name string) bool {
		registry.handleClosing(nil, name)
		return true
	}
	registry.requestApplicationQuit = func() {
		require.True(t, registry.PrepareApplicationQuit())
	}
	require.False(t, registry.PrepareApplicationQuit())
	for _, window := range windows {
		require.NoError(t, registry.AcknowledgeApplicationQuitPreflight(window, transactionID, true))
	}
	require.ElementsMatch(t, selections, runtime.Preferences.SelectedKubeconfigs(),
		"quitting the application must retain clusters belonging only to earlier-closed windows")
	reloaded := backend.NewApplicationRuntime(nil)
	t.Cleanup(func() { require.NoError(t, reloaded.Lifecycle.ServiceShutdown()) })
	_, err := reloaded.Preferences.EnsureLoadedForStartup()
	require.NoError(t, err)
	require.ElementsMatch(t, selections, reloaded.Preferences.SelectedKubeconfigs(),
		"a fresh preferences owner must restore every cluster from disk")
}
