package backend

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/appupdates"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"github.com/luxury-yacht/app/internal/sentry"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	"k8s.io/apimachinery/pkg/runtime"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	cgofake "k8s.io/client-go/kubernetes/fake"
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
	app := NewApplicationRuntime(nil)
	app.Lifecycle.setupEnvironment()

	pathVar := os.Getenv("PATH")
	require.Contains(t, pathVar, target)
}

func TestContainsAuthPatternDoesNotTreatPermissionDenialAsAuthentication(t *testing.T) {
	require.True(t, containsAuthPattern("request unauthorized"))
	require.False(t, containsAuthPattern("watch is forbidden"))
	require.False(t, containsAuthPattern("permission denied"))
	require.False(t, containsAuthPattern("access denied"))
}

func TestSetupRefreshSubsystemRequiresSelections(t *testing.T) {
	app := NewApplicationRuntime(nil)
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())

	err := app.Workspace.setupRefreshSubsystem()
	require.Error(t, err)
}

func TestSetupRefreshSubsystemRequiresContext(t *testing.T) {
	app := NewApplicationRuntime(nil)

	err := app.Workspace.setupRefreshSubsystem()
	require.Error(t, err)
}

func TestEnsureRefreshRuntimeContextGuardsMissingContextAndReusesLiveRuntime(t *testing.T) {
	var nilRefresh *RefreshCoordinator
	require.Nil(t, nilRefresh.ensureRefreshRuntimeContext())
	require.Nil(t, nilRefresh.currentRefreshRuntimeContext())
	nilRefresh.stopRefreshRuntimeContext()

	app := NewApplicationRuntime(nil)
	require.Nil(t, app.Refresh.ensureRefreshRuntimeContext())

	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	first := app.Refresh.ensureRefreshRuntimeContext()
	require.NotNil(t, first)
	t.Cleanup(app.Refresh.refreshCancel)

	second := app.Refresh.ensureRefreshRuntimeContext()
	require.Equal(t, first.Done(), second.Done(), "an active refresh runtime must not be replaced")
}

func TestEnsureRefreshRuntimeContextSharesOneRuntimeAcrossLifecycleCallers(t *testing.T) {
	parent, cancelParent := context.WithCancel(context.Background())
	t.Cleanup(cancelParent)
	app := NewApplicationRuntime(nil)
	setTestAppRuntimeReady(t, app.Lifecycle, parent)

	const callers = 32
	contexts := make([]context.Context, callers)
	start := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(callers)
	for index := range callers {
		go func() {
			defer wg.Done()
			if index%2 == 0 {
				app.Workspace.selectionMutationMu.Lock()
				defer app.Workspace.selectionMutationMu.Unlock()
			} else {
				app.Refresh.governorReconcileMu.Lock()
				defer app.Refresh.governorReconcileMu.Unlock()
			}
			<-start
			contexts[index] = app.Refresh.ensureRefreshRuntimeContext()
		}()
	}
	close(start)
	wg.Wait()

	first := contexts[0]
	require.NotNil(t, first)
	for _, runtimeCtx := range contexts[1:] {
		require.Equal(t, first.Done(), runtimeCtx.Done(), "all lifecycle paths must share one refresh runtime")
	}
	if app.Refresh.refreshCancel != nil {
		app.Refresh.refreshCancel()
	}
}

func TestSetupRefreshSubsystemDoesNotStorePermissionCache(t *testing.T) {
	app := NewApplicationRuntime(nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	setTestAppRuntimeReady(t, app.Lifecycle, ctx)

	// Create per-cluster clients - there are no global client fields anymore.
	fakeClient := cgofake.NewClientset()
	metricsClient := &metricsclient.Clientset{}
	restConfig := &rest.Config{}
	dynamicClient := dynamicfake.NewSimpleDynamicClient(runtime.NewScheme())
	apiExtensionsClient := &apiextensionsclientset.Clientset{}
	// Seed a valid selection/cluster client entry so refresh setup skips real kubeconfig IO.
	app.ClusterRuntime.availableKubeconfigs = []KubeconfigInfo{{
		Name:    "config",
		Path:    "/tmp/config",
		Context: "selection",
	}}
	app.Workspace.selectedKubeconfigs = []string{"/tmp/config:selection"}
	clusterID := app.ClusterRuntime.clusterMetaForSelection(kubeconfigSelection{Path: "/tmp/config", Context: "selection"}).ID
	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
		clusterID: {
			meta:                ClusterMeta{ID: clusterID, Name: "selection"},
			kubeconfigPath:      "/tmp/config",
			kubeconfigContext:   "selection",
			client:              fakeClient,
			metricsClient:       metricsClient,
			restConfig:          restConfig,
			dynamicClient:       dynamicClient,
			apiextensionsClient: apiExtensionsClient,
		},
	}
	manager := refresh.NewManager(nil, nil, nil, nil, nil)
	handler := http.NewServeMux()

	var capturedCfg system.Config
	original := newRefreshSubsystemWithServices
	newRefreshSubsystemWithServices = func(cfg system.Config) (*system.Subsystem, error) {
		capturedCfg = cfg
		return &system.Subsystem{
			Manager:   manager,
			Handler:   handler,
			Telemetry: telemetry.NewRecorder(),
		}, nil
	}
	defer func() { newRefreshSubsystemWithServices = original }()

	err := app.Workspace.setupRefreshSubsystem()
	require.NoError(t, err)
	defer app.Refresh.teardownRefreshSubsystem()

	// Note: app.refreshManager is now nil by design - there is no global primary cluster.
	// The manager is per-cluster, accessible via refreshSubsystems[clusterID].Manager.
	require.NotNil(t, app.Refresh.refreshService.Load())
	require.NotNil(t, app.Refresh.refreshCancel)

	require.Equal(t, fakeClient, capturedCfg.KubernetesClient)
	require.Equal(t, metricsClient, capturedCfg.MetricsClient)
	require.Equal(t, restConfig, capturedCfg.RestConfig)
	require.Equal(t, apiExtensionsClient, capturedCfg.APIExtensionsClient)
	require.Equal(t, dynamicClient, capturedCfg.DynamicClient)
	require.NotNil(t, capturedCfg.ObjectDetailsProvider)

	require.NotNil(t, app.Refresh.currentTelemetryRecorder())
	summary := app.Refresh.currentTelemetryRecorder().SnapshotSummary()
	require.Nil(t, summary.Catalog)
}

func TestRestoreKubeconfigSelectionUsesSelectedKubeconfigs(t *testing.T) {
	app := NewApplicationRuntime(nil)
	app.ClusterRuntime.availableKubeconfigs = []KubeconfigInfo{
		{Path: "/other/config", Context: "other"},
		{Path: "/saved/config", Context: "saved"},
	}
	app.Preferences.appSettings = &AppSettings{
		SelectedKubeconfigs: []string{"/saved/config:saved", "/other/config:other"},
	}

	app.Workspace.restoreKubeconfigSelection()

	require.Equal(t, []string{"/saved/config:saved", "/other/config:other"}, app.Workspace.selectedKubeconfigs)
}

func TestRestoreKubeconfigSelectionNoSettingsLeavesEmpty(t *testing.T) {
	t.Run("no saved selections returns empty", func(t *testing.T) {
		app := NewApplicationRuntime(nil)
		app.ClusterRuntime.availableKubeconfigs = []KubeconfigInfo{
			{Path: "/current/config", Context: "current", IsDefault: true, IsCurrentContext: true},
			{Path: "/other/config", Context: "other"},
		}

		app.Workspace.restoreKubeconfigSelection()

		require.Empty(t, app.Workspace.selectedKubeconfigs)
	})

	t.Run("empty settings returns empty", func(t *testing.T) {
		app := NewApplicationRuntime(nil)
		app.Preferences.appSettings = &AppSettings{}
		app.ClusterRuntime.availableKubeconfigs = []KubeconfigInfo{
			{Path: "/first/config", Context: "first"},
			{Path: "/second/config", Context: "second"},
		}

		app.Workspace.restoreKubeconfigSelection()

		require.Empty(t, app.Workspace.selectedKubeconfigs)
	})
}

func TestStdLogBridgeWritesToLogger(t *testing.T) {
	app := NewApplicationRuntime(nil)
	bridge := &stdLogBridge{logger: app.AppLogs.logger}

	input := "error: failure\nwarning: heads up\nrequest failed while listing pods\nExternal secrets cache ready\nI0102 info klog\n"
	n, err := bridge.Write([]byte(input))
	require.NoError(t, err)
	require.Equal(t, len(input), n)

	entries := app.AppLogs.logger.GetEntries()
	require.Len(t, entries, 5)
	require.Equal(t, "ERROR", entries[0].Level)
	require.Equal(t, "WARN", entries[1].Level)
	require.Equal(t, "ERROR", entries[2].Level)
	require.Equal(t, "INFO", entries[3].Level)
	require.Equal(t, "INFO", entries[4].Level)
}

func TestInitKubernetesClientRequiresSelections(t *testing.T) {
	app := NewApplicationRuntime(nil)
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())

	err := app.Workspace.initKubernetesClient()
	require.Error(t, err)
	require.Contains(t, err.Error(), "no kubeconfig selections available")
}

func TestInitKubernetesClientFailsWhenRefreshSubsystemFails(t *testing.T) {
	app := NewApplicationRuntime(nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	setTestAppRuntimeReady(t, app.Lifecycle, ctx)

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
	// Seed a valid selection/client pool so initKubernetesClient only exercises refresh setup.
	app.ClusterRuntime.availableKubeconfigs = []KubeconfigInfo{{
		Name:    "config",
		Path:    configPath,
		Context: "test",
	}}
	app.Workspace.selectedKubeconfigs = []string{configPath + ":test"}
	clusterID := app.ClusterRuntime.clusterMetaForSelection(kubeconfigSelection{Path: configPath, Context: "test"}).ID
	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
		clusterID: {
			meta:                ClusterMeta{ID: clusterID, Name: "test"},
			kubeconfigPath:      configPath,
			kubeconfigContext:   "test",
			client:              cgofake.NewClientset(),
			metricsClient:       &metricsclient.Clientset{},
			restConfig:          &rest.Config{},
			dynamicClient:       dynamicfake.NewSimpleDynamicClient(runtime.NewScheme()),
			apiextensionsClient: &apiextensionsclientset.Clientset{},
		},
	}

	original := newRefreshSubsystemWithServices
	newRefreshSubsystemWithServices = func(cfg system.Config) (*system.Subsystem, error) {
		return nil, errors.New("boom")
	}
	defer func() { newRefreshSubsystemWithServices = original }()

	err := app.Workspace.initKubernetesClient()
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to initialise refresh subsystem")
	require.Nil(t, app.Refresh.objectCatalogServiceForCluster(""))
	require.Nil(t, app.Refresh.currentTelemetryRecorder())
	// Note: clusterClients were pre-seeded by this test and are not cleared on refresh failure.
	// The test verifies that an error is returned and no object catalog is created.
}

func TestStartupLoadsWindowSettingsOnlyAfterRuntimeReady(t *testing.T) {
	baseDir := t.TempDir()
	t.Setenv("HOME", baseDir)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(baseDir, ".config"))
	t.Setenv("APPDATA", filepath.Join(baseDir, "AppData", "Roaming"))
	app := NewApplicationRuntime(nil)
	ctx, cancel := context.WithCancel(context.Background())

	settingsPath, err := app.Preferences.getSettingsFilePath()
	require.NoError(t, err)
	settings := &settingsFile{
		SchemaVersion: settingsSchemaVersion,
		UpdatedAt:     time.Now().UTC(),
		Preferences: settingsPreferences{
			AppearanceMode:           "system",
			GridTablePersistenceMode: "shared",
		},
		UI: settingsUI{
			Window: WindowSettings{X: -1800, Y: 20, Width: 900, Height: 700, Maximized: true},
		},
	}
	bytes, err := json.Marshal(settings)
	require.NoError(t, err)
	writeTestFileWithParents(t, settingsPath, bytes, 0o644)

	require.NoError(t, app.Lifecycle.ServiceStartup(ctx, application.ServiceOptions{}))
	require.Nil(t, app.Preferences.windowSettings, "service startup must not load interactive window state")
	require.True(t, app.Lifecycle.WindowRuntimeReady("workspace-1", true))
	cancel()
	time.Sleep(50 * time.Millisecond)

	require.Equal(t, &settings.UI.Window, app.Preferences.windowSettings)
}

func TestEveryPeerHandlesRuntimeReadyWhileProcessStartupRunsOnce(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	app := NewApplicationRuntime(nil)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	require.NoError(t, app.Lifecycle.ServiceStartup(ctx, application.ServiceOptions{}))
	require.True(t, app.Lifecycle.WindowRuntimeReady("workspace-1", true))
	require.False(t, app.Lifecycle.WindowRuntimeReady("workspace-2", false))
	require.True(t, app.Lifecycle.runtimeAvailable())
}

func TestBeforeClosePersistsWindowSettings(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	app := NewApplicationRuntime(nil)
	app.DesktopShell.windowGeometry = func() (WindowGeometry, error) {
		return WindowGeometry{X: 11, Y: 22, Width: 800, Height: 600, Maximised: true}, nil
	}
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())

	require.True(t, app.Lifecycle.PrepareQuitFromWindow("workspace-1"), "expected the application quit to proceed")

	settings, err := app.Preferences.LoadWindowSettings()
	require.NoError(t, err)
	require.Equal(t, 11, settings.X)
	require.Equal(t, 22, settings.Y)
	require.Equal(t, 800, settings.Width)
	require.Equal(t, 600, settings.Height)
	require.True(t, settings.Maximized)
}

func TestBeforeCloseWaitsForSelectionMutationBeforeSavingWindowSettings(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	app := NewApplicationRuntime(nil)
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())

	saveStarted := make(chan struct{})
	var saveStartedOnce sync.Once
	app.DesktopShell.windowGeometry = func() (WindowGeometry, error) {
		saveStartedOnce.Do(func() { close(saveStarted) })
		return WindowGeometry{X: 11, Y: 22, Width: 800, Height: 600}, nil
	}

	app.Workspace.selectionMutationMu.Lock()
	mutationStarted := make(chan struct{})
	mutationRelease := make(chan struct{})
	mutationDone := make(chan error, 1)
	go func() {
		mutationDone <- app.Workspace.runSelectionMutation("queued-before-close", func(*selectionMutation) error {
			close(mutationStarted)
			<-mutationRelease
			return nil
		})
	}()

	require.Eventually(t, func() bool {
		app.Workspace.selectionMutationDrainMu.Lock()
		defer app.Workspace.selectionMutationDrainMu.Unlock()
		return app.Workspace.selectionMutationPending == 1
	}, time.Second, 10*time.Millisecond)

	done := make(chan bool)
	go func() {
		done <- app.Lifecycle.PrepareQuitFromWindow("workspace-1")
	}()

	select {
	case <-saveStarted:
		t.Fatal("window settings save started before selection mutation completed")
	case <-time.After(25 * time.Millisecond):
	}

	app.Workspace.selectionMutationMu.Unlock()
	<-mutationStarted
	close(mutationRelease)
	require.NoError(t, <-mutationDone)

	select {
	case proceed := <-done:
		require.True(t, proceed, "expected the application quit to proceed")
	case <-time.After(time.Second):
		t.Fatal("before close did not finish after selection mutation completed")
	}

	select {
	case <-saveStarted:
	default:
		t.Fatal("window settings save did not start")
	}
}

func TestPrepareQuitWithoutRuntimeSkipsWindowReadAndRemainsIdempotent(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	app := NewApplicationRuntime(nil)
	geometryReads := 0
	app.DesktopShell.windowGeometry = func() (WindowGeometry, error) {
		geometryReads++
		return WindowGeometry{}, nil
	}

	require.True(t, app.Lifecycle.PrepareQuitFromWindow("workspace-1"))
	require.True(t, app.Lifecycle.PrepareQuitFromWindow("workspace-1"))

	require.Zero(t, geometryReads)
	failureLogs := 0
	for _, entry := range app.AppLogs.logger.GetEntries() {
		if strings.Contains(entry.Message, "Failed to save window settings: application context is not available") {
			failureLogs++
		}
	}
	require.Equal(t, 1, failureLogs)
}

func TestPrepareQuitLogsWindowGeometryReadFailure(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	app := NewApplicationRuntime(nil)
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	readFailure := errors.New("geometry unavailable")
	app.DesktopShell.windowGeometry = func() (WindowGeometry, error) {
		return WindowGeometry{}, readFailure
	}

	require.True(t, app.Lifecycle.PrepareQuitFromWindow("workspace-1"))

	require.Nil(t, app.Preferences.windowSettings)
	entries := app.AppLogs.logger.GetEntries()
	require.NotEmpty(t, entries)
	require.Contains(t, entries[len(entries)-1].Message, `read window "workspace-1" geometry: geometry unavailable`)
}

func TestPrepareQuitPersistsWindowGeometryOnlyOnceAcrossQuitPaths(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	app := NewApplicationRuntime(nil)
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	geometryReads := 0
	app.DesktopShell.windowGeometry = func() (WindowGeometry, error) {
		geometryReads++
		return WindowGeometry{X: 7, Y: 9, Width: 1000, Height: 700}, nil
	}

	require.True(t, app.Lifecycle.PrepareQuitFromWindow("workspace-1"))
	require.True(t, app.Lifecycle.PrepareQuitFromWindow("workspace-1"))

	require.Equal(t, 1, geometryReads)
	settings, err := app.Preferences.LoadWindowSettings()
	require.NoError(t, err)
	require.Equal(t, &WindowSettings{X: 7, Y: 9, Width: 1000, Height: 700}, settings)
}

func TestServiceLifecycleContextIsCancelledBeforeShutdownAndThenCleared(t *testing.T) {
	app := NewApplicationRuntime(nil)
	ctx, cancel := context.WithCancel(context.Background())
	require.NoError(t, app.Lifecycle.ServiceStartup(ctx, application.ServiceOptions{}))
	require.False(t, app.Lifecycle.runtimeAvailable())

	serviceContext := app.Lifecycle.CtxOrBackground()
	cancel()
	require.ErrorIs(t, serviceContext.Err(), context.Canceled)

	require.NoError(t, app.Lifecycle.ServiceShutdown())
	require.False(t, app.Lifecycle.runtimeAvailable())
	require.NoError(t, app.Lifecycle.CtxOrBackground().Err())
}

func TestStartupBetaExpiryReportsAndStopsInteractiveStartup(t *testing.T) {
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

	reporter := &recordingErrorReporter{}
	app := NewApplicationRuntime(nil, reporter)
	app.Lifecycle.eventEmitter = func(context.Context, string, ...interface{}) {}
	updates := &fakeApplicationUpdateCoordinator{}
	app.Updates.coordinator = updates
	var prompt expiredBetaPrompt
	app.DesktopShell.showExpiredBetaPrompt = func(value expiredBetaPrompt) { prompt = value }
	var openedURL string
	app.DesktopShell.openApplicationURL = func(value string) error {
		openedURL = value
		return nil
	}
	quitCalls := 0
	app.DesktopShell.quitApplication = func() { quitCalls++ }
	ctx := context.Background()

	require.NoError(t, app.Lifecycle.ServiceStartup(ctx, application.ServiceOptions{}))
	require.True(t, app.Lifecycle.WindowRuntimeReady("workspace-1", true))

	reporter.mu.Lock()
	require.Len(t, reporter.exceptions, 1)
	require.Contains(t, reporter.exceptions[0].err.Error(), "expired")
	require.Equal(t, sentryreporting.Operation{}, reporter.exceptions[0].context.Operation)
	reporter.mu.Unlock()
	require.Equal(t, "Beta Version Expired", prompt.Title)
	require.Equal(t, "Download Latest Version", prompt.DownloadLabel)
	require.Equal(t, "Quit", prompt.QuitLabel)
	require.NotNil(t, prompt.OnDownload)
	require.NotNil(t, prompt.OnQuit)
	prompt.OnDownload()
	require.Equal(t, applicationDownloadsURL, openedURL)
	require.Equal(t, 1, quitCalls)
	require.Zero(t, updates.runtimeReadyCalls)
	require.Zero(t, updates.downloadCalls)
	require.Zero(t, updates.restartCalls)
}

func TestApplicationUpdateCoordinatorFollowsProcessRuntimeLifecycle(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	coordinator := &fakeApplicationUpdateCoordinator{
		snapshot: appupdates.Snapshot{Status: appupdates.StatusIdle},
	}
	app := NewApplicationRuntime(nil)
	app.Updates.coordinator = coordinator
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	require.NoError(t, app.Lifecycle.ServiceStartup(ctx, application.ServiceOptions{}))
	require.Zero(t, coordinator.runtimeReadyCalls)
	require.True(t, app.Lifecycle.WindowRuntimeReady("workspace-1", false))
	require.Equal(t, 1, coordinator.runtimeReadyCalls)
	require.False(t, app.Lifecycle.WindowRuntimeReady("workspace-2", false))
	require.Equal(t, 1, coordinator.runtimeReadyCalls)

	require.NoError(t, app.Lifecycle.ServiceShutdown())
	require.Equal(t, 1, coordinator.stopCalls)
}
