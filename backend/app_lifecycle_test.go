package backend

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/informer"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"github.com/stretchr/testify/require"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	"k8s.io/apimachinery/pkg/runtime"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/rest"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
)

func TestSetupEnvironmentAddsHomeLocalBin(t *testing.T) {
	t.Setenv("PATH", "/usr/bin")
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)

	target := filepath.Join(homeDir, ".local", "bin")
	require.NoError(t, os.MkdirAll(target, 0o755))

	envSetupOnce = sync.Once{}
	app := newTestAppWithDefaults(t)
	app.setupEnvironment()

	pathVar := os.Getenv("PATH")
	require.Contains(t, pathVar, target)
}

func TestSetupRefreshSubsystemRequiresClient(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()

	cache, err := app.setupRefreshSubsystem(nil, "", nil)
	require.Error(t, err)
	require.Nil(t, cache)
}

func TestSetupRefreshSubsystemRequiresContext(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = nil

	cache, err := app.setupRefreshSubsystem(kubernetesfake.NewSimpleClientset(), "", nil)
	require.Error(t, err)
	require.Nil(t, cache)
}

func TestSetupRefreshSubsystemStoresPermissionCache(t *testing.T) {
	app := newTestAppWithDefaults(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	app.Ctx = ctx

	app.metricsClient = &metricsclient.Clientset{}
	app.dynamicClient = dynamicfake.NewSimpleDynamicClient(runtime.NewScheme())
	app.apiextensionsClient = &apiextensionsclientset.Clientset{}
	app.restConfig = &rest.Config{}

	initialCache := map[string]bool{"list": true}
	fakeClient := kubernetesfake.NewSimpleClientset()
	manager := refresh.NewManager(nil, nil, nil, nil, nil)
	handler := http.NewServeMux()

	var capturedCfg system.Config
	original := newRefreshSubsystem
	newRefreshSubsystem = func(cfg system.Config) (*refresh.Manager, http.Handler, *telemetry.Recorder, []system.PermissionIssue, map[string]bool, *informer.Factory, error) {
		capturedCfg = cfg
		return manager, handler, telemetry.NewRecorder(), nil, map[string]bool{"watch": true}, nil, nil
	}
	defer func() { newRefreshSubsystem = original }()

	cache, err := app.setupRefreshSubsystem(fakeClient, "selection", initialCache)
	require.NoError(t, err)
	defer app.teardownRefreshSubsystem()

	require.NotNil(t, app.refreshManager)
	require.NotNil(t, app.refreshHTTPServer)
	require.NotNil(t, app.refreshListener)
	require.NotNil(t, app.refreshCancel)
	require.NotEmpty(t, app.refreshBaseURL)

	require.NotNil(t, cache)
	require.Equal(t, map[string]bool{"watch": true}, cache)

	stored := app.getPermissionCache("selection")
	require.NotNil(t, stored)
	require.Equal(t, map[string]bool{"watch": true}, stored)

	require.Equal(t, fakeClient, capturedCfg.KubernetesClient)
	require.Equal(t, app.metricsClient, capturedCfg.MetricsClient)
	require.Equal(t, app.restConfig, capturedCfg.RestConfig)
	require.Equal(t, app.apiextensionsClient, capturedCfg.APIExtensionsClient)
	require.Equal(t, app.dynamicClient, capturedCfg.DynamicClient)
	require.NotNil(t, capturedCfg.HelmFactory)
	require.NotNil(t, capturedCfg.ObjectDetailsProvider)
	require.Equal(t, initialCache, capturedCfg.PermissionCache)

	require.NotNil(t, app.telemetryRecorder)
	summary := app.telemetryRecorder.SnapshotSummary()
	require.Nil(t, summary.Catalog)
}

func TestRestoreKubeconfigSelectionPrefersSavedContext(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.availableKubeconfigs = []KubeconfigInfo{
		{Path: "/other/config", Context: "other"},
		{Path: "/saved/config", Context: "saved"},
	}
	app.appSettings = &AppSettings{SelectedKubeconfig: "/saved/config:saved"}

	app.restoreKubeconfigSelection()

	require.Equal(t, "/saved/config", app.selectedKubeconfig)
	require.Equal(t, "saved", app.selectedContext)
}

func TestRestoreKubeconfigSelectionFallsBack(t *testing.T) {
	t.Run("defaults to current context", func(t *testing.T) {
		app := newTestAppWithDefaults(t)
		app.availableKubeconfigs = []KubeconfigInfo{
			{Path: "/current/config", Context: "current", IsDefault: true, IsCurrentContext: true},
			{Path: "/other/config", Context: "other"},
		}

		app.restoreKubeconfigSelection()

		require.Equal(t, "/current/config", app.selectedKubeconfig)
		require.Equal(t, "current", app.selectedContext)
	})

	t.Run("defaults to first default entry", func(t *testing.T) {
		app := newTestAppWithDefaults(t)
		app.availableKubeconfigs = []KubeconfigInfo{
			{Path: "/default/config", Context: "default", IsDefault: true},
			{Path: "/other/config", Context: "other"},
		}

		app.restoreKubeconfigSelection()

		require.Equal(t, "/default/config", app.selectedKubeconfig)
		require.Equal(t, "default", app.selectedContext)
	})

	t.Run("falls back to first when no defaults", func(t *testing.T) {
		app := newTestAppWithDefaults(t)
		app.availableKubeconfigs = []KubeconfigInfo{
			{Path: "/first/config", Context: "first"},
			{Path: "/second/config", Context: "second"},
		}

		app.restoreKubeconfigSelection()

		require.Equal(t, "/first/config", app.selectedKubeconfig)
		require.Equal(t, "first", app.selectedContext)
	})
}

func TestStdLogBridgeWritesToLogger(t *testing.T) {
	app := newTestAppWithDefaults(t)
	bridge := &stdLogBridge{logger: app.logger}

	n, err := bridge.Write([]byte("error: failure\nwarning: heads up\nall good\n"))
	require.NoError(t, err)
	require.Equal(t, len("error: failure\nwarning: heads up\nall good\n"), n)

	entries := app.logger.GetEntries()
	require.Len(t, entries, 3)
	require.Equal(t, "ERROR", entries[0].Level)
	require.Equal(t, "WARN", entries[1].Level)
	require.Equal(t, "INFO", entries[2].Level)
}

func TestInitKubernetesClientSkipsWhenAlreadyInitialised(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.client = kubernetesfake.NewSimpleClientset()

	err := app.initKubernetesClient()
	require.NoError(t, err)

	entries := app.logger.GetEntries()
	require.NotEmpty(t, entries)
	last := entries[len(entries)-1]
	require.Equal(t, "DEBUG", last.Level)
	require.Contains(t, last.Message, "already initialized")
}

func TestInitKubernetesClientFailsWhenRefreshSubsystemFails(t *testing.T) {
	app := newTestAppWithDefaults(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	app.Ctx = ctx

	kubeconfig := `
apiVersion: v1
clusters:
- cluster:
    insecure-skip-tls-verify: true
    server: https://example.invalid
  name: test
contexts:
- context:
    cluster: test
    user: test
  name: test
current-context: test
users:
- name: test
  user:
    token: dummy
`
	configDir := t.TempDir()
	configPath := filepath.Join(configDir, "config")
	require.NoError(t, os.WriteFile(configPath, []byte(kubeconfig), 0o600))
	app.selectedKubeconfig = configPath

	original := newRefreshSubsystem
	newRefreshSubsystem = func(cfg system.Config) (*refresh.Manager, http.Handler, *telemetry.Recorder, []system.PermissionIssue, map[string]bool, *informer.Factory, error) {
		return nil, nil, nil, nil, nil, nil, errors.New("boom")
	}
	defer func() { newRefreshSubsystem = original }()

	err := app.initKubernetesClient()
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to initialise refresh subsystem")
	require.Nil(t, app.objectCatalogService)
	require.Nil(t, app.telemetryRecorder)
	require.Nil(t, app.client)
}

func TestStartupAppliesWindowSettings(t *testing.T) {
	origEvents := runtimeEventsEmit
	origMsg := runtimeMessageDialog
	origQuit := runtimeQuit
	origSize := runtimeWindowSetSize
	origPos := runtimeWindowSetPos
	origMax := runtimeWindowMaximise
	origShow := runtimeWindowShow
	t.Cleanup(func() {
		runtimeEventsEmit = origEvents
		runtimeMessageDialog = origMsg
		runtimeQuit = origQuit
		runtimeWindowSetSize = origSize
		runtimeWindowSetPos = origPos
		runtimeWindowMaximise = origMax
		runtimeWindowShow = origShow
	})

	t.Setenv("HOME", t.TempDir())
	app := newTestAppWithDefaults(t)
	ctx, cancel := context.WithCancel(context.Background())
	app.Ctx = ctx

	configDir := filepath.Join(os.Getenv("HOME"), ".config", "luxury-yacht")
	require.NoError(t, os.MkdirAll(configDir, 0o755))
	settingsPath := filepath.Join(configDir, "window-settings.json")
	require.NoError(t, os.WriteFile(settingsPath, []byte(`{"x":10,"y":20,"width":900,"height":700,"maximized":true}`), 0o644))

	var sizeCalled, posCalled, maxCalled, showCalled bool
	runtimeEventsEmit = func(context.Context, string, ...interface{}) {}
	runtimeMessageDialog = func(context.Context, wailsruntime.MessageDialogOptions) (string, error) { return "", nil }
	runtimeQuit = func(context.Context) {}
	runtimeWindowSetSize = func(context.Context, int, int) { sizeCalled = true }
	runtimeWindowSetPos = func(context.Context, int, int) { posCalled = true }
	runtimeWindowMaximise = func(context.Context) { maxCalled = true }
	runtimeWindowShow = func(context.Context) { showCalled = true }

	app.Startup(ctx)
	cancel()
	time.Sleep(50 * time.Millisecond)

	require.True(t, sizeCalled, "expected window size to be restored")
	require.True(t, posCalled, "expected window position to be restored")
	require.True(t, maxCalled, "expected window to be maximized")
	require.True(t, showCalled, "expected window to be shown")
}

func TestBeforeClosePersistsWindowSettings(t *testing.T) {
	origGetPos := runtimeWindowGetPosition
	origGetSize := runtimeWindowGetSize
	origIsMax := runtimeWindowIsMaximised
	t.Cleanup(func() {
		runtimeWindowGetPosition = origGetPos
		runtimeWindowGetSize = origGetSize
		runtimeWindowIsMaximised = origIsMax
	})

	t.Setenv("HOME", t.TempDir())
	app := newTestAppWithDefaults(t)
	ctx := context.Background()
	app.Ctx = ctx

	runtimeWindowGetPosition = func(context.Context) (int, int) { return 11, 22 }
	runtimeWindowGetSize = func(context.Context) (int, int) { return 800, 600 }
	runtimeWindowIsMaximised = func(context.Context) bool { return true }

	beforeClose := NewBeforeCloseHandler(app)

	prevent := beforeClose(ctx)
	require.False(t, prevent, "expected the window close to proceed")

	settings, err := app.LoadWindowSettings()
	require.NoError(t, err)
	require.Equal(t, 11, settings.X)
	require.Equal(t, 22, settings.Y)
	require.Equal(t, 800, settings.Width)
	require.Equal(t, 600, settings.Height)
	require.True(t, settings.Maximized)
}

func TestStartupBetaExpiryShowsDialogAndQuits(t *testing.T) {
	origEvents := runtimeEventsEmit
	origMsg := runtimeMessageDialog
	origQuit := runtimeQuit
	t.Cleanup(func() {
		runtimeEventsEmit = origEvents
		runtimeMessageDialog = origMsg
		runtimeQuit = origQuit
	})

	origBeta := BetaExpiry
	origIsBeta := IsBetaBuild
	origVersion := Version
	t.Cleanup(func() {
		BetaExpiry = origBeta
		IsBetaBuild = origIsBeta
		Version = origVersion
	})

	BetaExpiry = time.Now().Add(-24 * time.Hour).UTC().Format(time.RFC3339)
	IsBetaBuild = "true"
	Version = "1.2.3"

	t.Setenv("HOME", t.TempDir())

	app := newTestAppWithDefaults(t)
	ctx := context.Background()
	app.Ctx = ctx

	dialogCalled := false
	quitCalled := false
	runtimeMessageDialog = func(context.Context, wailsruntime.MessageDialogOptions) (string, error) {
		dialogCalled = true
		return "", nil
	}
	runtimeQuit = func(context.Context) {
		quitCalled = true
	}
	runtimeEventsEmit = func(context.Context, string, ...interface{}) {}

	app.Startup(ctx)

	require.True(t, dialogCalled, "beta expiry dialog expected")
	require.True(t, quitCalled, "app should quit when beta expired")
}
