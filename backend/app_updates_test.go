package backend

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/appupdates"
	"github.com/luxury-yacht/app/internal/updateidentity"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/updater"
)

type fakeApplicationUpdateCoordinator struct {
	snapshot          appupdates.Snapshot
	checkCalls        int
	checkStarted      chan struct{}
	downloadCalls     int
	restartCalls      int
	downloadVersion   string
	runtimeReadyCalls int
	stopCalls         int
}

type fakeUpdateEventRegistrar struct {
	callbacks map[string]func(*application.CustomEvent)
}

type fakeUpdaterClient struct {
	state updater.State
}

func (client *fakeUpdaterClient) Init(updater.Config) error {
	client.state = updater.StateIdle
	return nil
}

func (*fakeUpdaterClient) Check(context.Context) (*updater.Release, error) { return nil, nil }
func (*fakeUpdaterClient) DownloadAndInstall(context.Context) error        { return nil }
func (*fakeUpdaterClient) Restart(context.Context) error                   { return nil }
func (client *fakeUpdaterClient) State() updater.State                     { return client.state }

type fakeUpdaterProvider struct{}

func (fakeUpdaterProvider) Name() string { return "fake" }
func (fakeUpdaterProvider) Check(context.Context, updater.CheckRequest) (*updater.Release, error) {
	return nil, nil
}
func (fakeUpdaterProvider) Download(context.Context, *updater.Release, io.Writer, func(int64, int64)) error {
	return nil
}

func enabledApplicationUpdateBuild() updateidentity.BuildEligibility {
	return updateidentity.BuildEligibility{
		Status:  updateidentity.BuildEnabled,
		Release: updateidentity.ReleaseVersion{Version: "2.0.0-beta.3", Channel: updateidentity.ChannelBeta},
		Installation: updateidentity.InstallationEligibility{
			CanCheck: true, CanInstall: true, Distribution: updateidentity.DistributionMacBundle,
		},
		CanInitialize: true,
		CanCheck:      true,
		CanInstall:    true,
	}
}

func (registrar *fakeUpdateEventRegistrar) On(name string, callback func(*application.CustomEvent)) func() {
	if registrar.callbacks == nil {
		registrar.callbacks = make(map[string]func(*application.CustomEvent))
	}
	registrar.callbacks[name] = callback
	return func() { delete(registrar.callbacks, name) }
}

func (coordinator *fakeApplicationUpdateCoordinator) Snapshot() appupdates.Snapshot {
	return coordinator.snapshot
}

func (coordinator *fakeApplicationUpdateCoordinator) RuntimeReady() {
	coordinator.runtimeReadyCalls++
}

func (coordinator *fakeApplicationUpdateCoordinator) Stop() {
	coordinator.stopCalls++
}

func (coordinator *fakeApplicationUpdateCoordinator) Check(context.Context) (appupdates.Snapshot, error) {
	coordinator.checkCalls++
	if coordinator.checkStarted != nil {
		coordinator.checkStarted <- struct{}{}
	}
	return coordinator.snapshot, nil
}

func (coordinator *fakeApplicationUpdateCoordinator) Download(_ context.Context, version string) (appupdates.Snapshot, error) {
	coordinator.downloadCalls++
	coordinator.downloadVersion = version
	return coordinator.snapshot, nil
}

func (coordinator *fakeApplicationUpdateCoordinator) Restart(context.Context) (appupdates.Snapshot, error) {
	coordinator.restartCalls++
	return coordinator.snapshot, nil
}

func TestGetAppInfoReadsCoordinatorSnapshotWithoutStartingCheck(t *testing.T) {
	coordinator := &fakeApplicationUpdateCoordinator{snapshot: appupdates.Snapshot{
		Status:            appupdates.StatusAvailable,
		CurrentVersion:    "2.0.0-beta.3",
		AvailableVersion:  "2.0.0",
		ReleaseName:       "Luxury Yacht 2.0.0",
		PublishedAt:       "2026-08-14T12:30:00Z",
		ReleaseNotes:      "## Safer updates",
		CanCheck:          true,
		CanInstall:        true,
		Distribution:      updateidentity.DistributionMacBundle,
		EligibilityReason: "",
		RecoveryTarget:    "",
	}}
	app := NewApp(nil)
	app.applicationUpdates = coordinator

	info, err := app.GetAppInfo()

	require.NoError(t, err)
	require.NotNil(t, info.Update)
	require.Equal(t, UpdateInfo{
		Status:            appupdates.StatusAvailable,
		CurrentVersion:    "2.0.0-beta.3",
		AvailableVersion:  "2.0.0",
		ReleaseName:       "Luxury Yacht 2.0.0",
		PublishedAt:       "2026-08-14T12:30:00Z",
		ReleaseNotes:      "## Safer updates",
		CanCheck:          true,
		CanInstall:        true,
		Distribution:      updateidentity.DistributionMacBundle,
		EligibilityReason: "",
		RecoveryTarget:    "",
	}, *info.Update)
	require.Zero(t, coordinator.checkCalls)
}

func TestApplicationUpdateCommandsDelegateToOneProcessCoordinator(t *testing.T) {
	coordinator := &fakeApplicationUpdateCoordinator{snapshot: appupdates.Snapshot{
		Status: appupdates.StatusAvailable, AvailableVersion: "2.0.0",
	}}
	app := NewApp(nil)
	app.applicationUpdates = coordinator

	checked, err := app.CheckForUpdates()
	require.NoError(t, err)
	require.Equal(t, appupdates.StatusAvailable, checked.Status)
	require.Equal(t, 1, coordinator.checkCalls)
	require.Zero(t, coordinator.downloadCalls)

	downloaded, err := app.DownloadApplicationUpdate("2.0.0")
	require.NoError(t, err)
	require.Equal(t, "2.0.0", coordinator.downloadVersion)
	require.Equal(t, appupdates.StatusAvailable, downloaded.Status)
	require.Equal(t, 1, coordinator.downloadCalls)
	require.Zero(t, coordinator.restartCalls)

	restarted, err := app.RestartAndApplyApplicationUpdate()
	require.NoError(t, err)
	require.Equal(t, appupdates.StatusAvailable, restarted.Status)
	require.Equal(t, 1, coordinator.restartCalls)
}

func TestDisabledCheckCommandReturnsApplicationSnapshot(t *testing.T) {
	app := NewApp(nil)

	snapshot, err := app.CheckForUpdates()

	require.NoError(t, err)
	require.Equal(t, appupdates.StatusDisabled, snapshot.Status)
}

func TestCheckForUpdatesFromMenuOpensAboutBeforeStartingCheck(t *testing.T) {
	coordinator := &fakeApplicationUpdateCoordinator{
		snapshot:     appupdates.Snapshot{Status: appupdates.StatusIdle, CanCheck: true},
		checkStarted: make(chan struct{}, 1),
	}
	app := NewApp(nil)
	setTestAppRuntimeReady(t, app, context.Background())
	app.applicationUpdates = coordinator
	events := make(chan string, 1)
	app.eventEmitter = func(_ context.Context, name string, _ ...interface{}) {
		events <- name
	}

	app.showAboutAndCheckForUpdates()

	select {
	case event := <-events:
		require.Equal(t, "open-about", event)
	case <-time.After(time.Second):
		t.Fatal("About event was not emitted")
	}
	select {
	case <-coordinator.checkStarted:
		require.Equal(t, 1, coordinator.checkCalls)
	case <-time.After(time.Second):
		t.Fatal("update check was not started")
	}
}

func TestWailsUpdateEventsProjectToOneApplicationBroadcast(t *testing.T) {
	app := NewApp(nil)
	setTestAppRuntimeReady(t, app, context.Background())
	type emittedEvent struct {
		name string
		data []interface{}
	}
	var emitted []emittedEvent
	app.eventEmitter = func(_ context.Context, name string, data ...interface{}) {
		emitted = append(emitted, emittedEvent{name: name, data: data})
	}
	coordinator := appupdates.New(appupdates.Dependencies{
		Client: &fakeUpdaterClient{}, Provider: fakeUpdaterProvider{},
		Eligibility: enabledApplicationUpdateBuild(), PublicKey: make([]byte, 32),
		Platform: "darwin", Architecture: "arm64", TempRoot: "/owned/temp/root",
		OnChange: app.storeApplicationUpdateSnapshot,
	})
	app.applicationUpdates = coordinator
	registrar := &fakeUpdateEventRegistrar{}

	unsubscribers := subscribeApplicationUpdateEvents(registrar, coordinator)
	require.Len(t, unsubscribers, len(applicationUpdateEventNames))
	require.Contains(t, registrar.callbacks, updater.EventDownloadProgress)
	registrar.callbacks[updater.EventDownloadProgress](&application.CustomEvent{
		Name: updater.EventDownloadProgress,
		Data: updater.Progress{Written: 25, Total: 100},
	})

	info := app.getUpdateInfo()
	require.Equal(t, appupdates.StatusDownloading, info.Status)
	require.NotNil(t, info.ProgressPercent)
	require.Equal(t, float64(25), *info.ProgressPercent)
	require.Len(t, emitted, 1)
	require.Equal(t, "app-update", emitted[0].name)
	require.Equal(t, info, emitted[0].data[0])

	for _, unsubscribe := range unsubscribers {
		unsubscribe()
	}
	require.Empty(t, registrar.callbacks)
}

func TestResolveApplicationUpdateEligibilityUsesReleaseAndInstallIdentity(t *testing.T) {
	home := t.TempDir()
	bundle := filepath.Join(home, "Applications", "Luxury Yacht.app")
	executable := filepath.Join(bundle, "Contents", "MacOS", "luxury-yacht")
	require.NoError(t, os.MkdirAll(filepath.Dir(executable), 0o755))
	require.NoError(t, os.WriteFile(executable, []byte("binary"), 0o700))
	now := time.Date(2026, time.August, 14, 12, 0, 0, 0, time.UTC)

	eligibility, err := resolveApplicationUpdateEligibility(applicationUpdateRuntime{
		Version: "v2.0.0", Now: now, Platform: "darwin", Architecture: "arm64",
		ExecutablePath: executable, HomeDirectory: home,
	})

	require.NoError(t, err)
	require.Equal(t, updateidentity.BuildEnabled, eligibility.Status)
	require.True(t, eligibility.CanInitialize)
	require.True(t, eligibility.CanInstall)
	require.Equal(t, updateidentity.DistributionMacBundle, eligibility.Installation.Distribution)

	development, err := resolveApplicationUpdateEligibility(applicationUpdateRuntime{
		Version: "dev", Now: now, Platform: "darwin", Architecture: "arm64",
		ExecutablePath: filepath.Join(home, "does-not-exist"),
	})
	require.NoError(t, err)
	require.Equal(t, updateidentity.BuildDisabledDevelopment, development.Status)
}

func TestConfigureApplicationUpdatesDisablesOnTempSetupFailure(t *testing.T) {
	app := NewApp(nil)

	app.configureApplicationUpdates(ApplicationUpdateOptions{
		TempSetupError: errors.New("owned temp root unavailable"),
	})

	require.NotNil(t, app.applicationUpdates)
	require.Equal(t, appupdates.StatusDisabled, app.applicationUpdates.Snapshot().Status)
	require.False(t, app.applicationUpdates.Snapshot().CanInstall)
}

func TestApplicationUpdateCoordinatorFollowsProcessRuntimeLifecycle(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	coordinator := &fakeApplicationUpdateCoordinator{
		snapshot: appupdates.Snapshot{Status: appupdates.StatusIdle},
	}
	app := newTestAppWithDefaults(t)
	app.applicationUpdates = coordinator
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	require.NoError(t, app.ServiceStartup(ctx, application.ServiceOptions{}))
	require.Zero(t, coordinator.runtimeReadyCalls)
	require.True(t, app.WindowRuntimeReady("workspace-1", false))
	require.Equal(t, 1, coordinator.runtimeReadyCalls)
	require.False(t, app.WindowRuntimeReady("workspace-2", false))
	require.Equal(t, 1, coordinator.runtimeReadyCalls)

	require.NoError(t, app.ServiceShutdown())
	require.Equal(t, 1, coordinator.stopCalls)
}
