package backend

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/appupdates"
	"github.com/luxury-yacht/app/internal/updateidentity"
	"github.com/luxury-yacht/app/internal/updatestate"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/updater"
)

func TestEmbeddedApplicationUpdatePublicKeyMatchesApprovedTrustRoot(t *testing.T) {
	block, rest := pem.Decode(applicationUpdatePublicKey)
	require.NotNil(t, block)
	require.Empty(t, rest)
	require.Equal(t, "PUBLIC KEY", block.Type)
	parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
	require.NoError(t, err)
	publicKey, ok := parsed.(ed25519.PublicKey)
	require.True(t, ok)
	fingerprint := sha256.Sum256(block.Bytes)
	require.Equal(t, "5fb9230f10b42312008e6caa8c782e195a170970334b41d89b1c90e43820f15b", hex.EncodeToString(fingerprint[:]))
	require.Len(t, publicKey, ed25519.PublicKeySize)
}

type fakeApplicationUpdateCoordinator struct {
	snapshot          appupdates.Snapshot
	checkCalls        int
	checkStarted      chan struct{}
	downloadCalls     int
	restartCalls      int
	downloadVersion   string
	skipCalls         int
	skipVersion       string
	removeSkipCalls   int
	runtimeReadyCalls int
	stopCalls         int
	resetCalls        int
	resetErr          error
}

func (coordinator *fakeApplicationUpdateCoordinator) Reset(context.Context) error {
	coordinator.resetCalls++
	return coordinator.resetErr
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
func (*fakeUpdaterClient) DownloadedPath() string                          { return "" }
func (*fakeUpdaterClient) SkipVersion(string)                              {}

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

func (registrar *fakeUpdateEventRegistrar) Subscribe(name string, callback func(*application.CustomEvent)) func() {
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

func (coordinator *fakeApplicationUpdateCoordinator) Skip(_ context.Context, version string) (appupdates.Snapshot, error) {
	coordinator.skipCalls++
	coordinator.skipVersion = version
	return coordinator.snapshot, nil
}

func (coordinator *fakeApplicationUpdateCoordinator) RemoveSkip(context.Context) (appupdates.Snapshot, error) {
	coordinator.removeSkipCalls++
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
	app := newUpdateCoordinatorTestFixture(t)
	app.Updates.coordinator = coordinator

	info, err := app.Updates.GetAppInfo()

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
	app := newUpdateCoordinatorTestFixture(t)
	app.Updates.coordinator = coordinator

	checked, err := app.Updates.CheckForUpdates()
	require.NoError(t, err)
	require.Equal(t, appupdates.StatusAvailable, checked.Status)
	require.Equal(t, 1, coordinator.checkCalls)
	require.Zero(t, coordinator.downloadCalls)

	downloaded, err := app.Updates.DownloadApplicationUpdate("2.0.0")
	require.NoError(t, err)
	require.Equal(t, "2.0.0", coordinator.downloadVersion)
	require.Equal(t, appupdates.StatusAvailable, downloaded.Status)
	require.Equal(t, 1, coordinator.downloadCalls)
	require.Zero(t, coordinator.restartCalls)

	restarted, err := app.Updates.RestartAndApplyApplicationUpdate()
	require.NoError(t, err)
	require.Equal(t, appupdates.StatusAvailable, restarted.Status)
	require.Equal(t, 1, coordinator.restartCalls)

	skipped, err := app.Updates.SkipApplicationUpdate("2.0.0")
	require.NoError(t, err)
	require.Equal(t, appupdates.StatusAvailable, skipped.Status)
	require.Equal(t, "2.0.0", coordinator.skipVersion)
	require.Equal(t, 1, coordinator.skipCalls)
}

func TestRemoveApplicationUpdateSkipDelegatesToTheProcessCoordinator(t *testing.T) {
	coordinator := &fakeApplicationUpdateCoordinator{snapshot: appupdates.Snapshot{
		Status: appupdates.StatusAvailable, AvailableVersion: "2.0.0",
	}}
	app := newUpdateCoordinatorTestFixture(t)
	app.Updates.coordinator = coordinator

	snapshot, err := app.Updates.RemoveApplicationUpdateSkip()

	require.NoError(t, err)
	require.Equal(t, appupdates.StatusAvailable, snapshot.Status)
	require.Equal(t, 1, coordinator.removeSkipCalls)
}

func TestDisabledCheckCommandReturnsApplicationSnapshot(t *testing.T) {
	app := newUpdateCoordinatorTestFixture(t)

	snapshot, err := app.Updates.CheckForUpdates()

	require.NoError(t, err)
	require.Equal(t, appupdates.StatusDisabled, snapshot.Status)
}

func TestCheckForUpdatesFromMenuOpensAboutBeforeStartingCheck(t *testing.T) {
	coordinator := &fakeApplicationUpdateCoordinator{
		snapshot:     appupdates.Snapshot{Status: appupdates.StatusIdle, CanCheck: true},
		checkStarted: make(chan struct{}, 1),
	}
	app := newUpdateCoordinatorTestFixture(t)
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	app.Updates.coordinator = coordinator
	events := make(chan string, 1)
	app.Lifecycle.signalState().eventEmitter = func(_ context.Context, name string, _ ...interface{}) {
		events <- name
	}

	app.Updates.showAboutAndCheckForUpdates()

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
	app := newUpdateCoordinatorTestFixture(t)
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	type emittedEvent struct {
		name string
		data []interface{}
	}
	var emitted []emittedEvent
	app.Lifecycle.signalState().eventEmitter = func(_ context.Context, name string, data ...interface{}) {
		emitted = append(emitted, emittedEvent{name: name, data: data})
	}
	coordinator := appupdates.New(appupdates.Dependencies{
		Client: &fakeUpdaterClient{}, Provider: fakeUpdaterProvider{},
		Eligibility: enabledApplicationUpdateBuild(), PublicKey: make([]byte, 32),
		Platform: "darwin", Architecture: "arm64", TempRoot: "/owned/temp/root",
		OnChange: app.Updates.storeApplicationUpdateSnapshot,
	})
	app.Updates.coordinator = coordinator
	registrar := &fakeUpdateEventRegistrar{}

	unsubscribers := subscribeApplicationUpdateEvents(registrar, coordinator)
	require.Len(t, unsubscribers, len(applicationUpdateEventNames))
	require.Contains(t, registrar.callbacks, updater.EventDownloadProgress)
	registrar.callbacks[updater.EventDownloadProgress](&application.CustomEvent{
		Name: updater.EventDownloadProgress,
		Data: updater.Progress{Written: 25, Total: 100},
	})

	info := app.Updates.getUpdateInfo()
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
	app := newUpdateCoordinatorTestFixture(t)

	app.Updates.configureApplicationUpdates(ApplicationUpdateOptions{
		TempSetupError: errors.New("owned temp root unavailable"),
	})

	require.NotNil(t, app.Updates.coordinator)
	require.Equal(t, appupdates.StatusDisabled, app.Updates.coordinator.Snapshot().Status)
	require.False(t, app.Updates.coordinator.Snapshot().CanInstall)
}

func TestPrepareApplicationUpdateStateReconcilesBeforeSweepingOrphans(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "owned-temp")
	statePath := filepath.Join(base, "config", "application-update.json")
	require.NoError(t, os.Mkdir(root, 0o700))
	store, err := updatestate.New(updatestate.Config{
		StatePath: statePath,
		TempRoot:  root,
		PID:       func() int { return 4242 },
	})
	require.NoError(t, err)
	require.NoError(t, store.SetSkippedVersion("1.9.0"))
	staging := filepath.Join(root, "wails-update-active")
	require.NoError(t, os.Mkdir(staging, 0o700))
	require.NoError(t, store.RecordPrepared(updatestate.PreparedUpdate{
		TargetVersion:  "2.0.0",
		StagingDir:     staging,
		RecoveryTarget: updateidentity.RecoveryMacDownload,
	}))
	_, err = store.BeginAttempt(updatestate.AttemptMetadata{
		SourceVersion: "2.0.0-beta.3",
		Platform:      "darwin",
		Architecture:  "arm64",
		Distribution:  updateidentity.DistributionMacBundle,
	})
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(
		filepath.Join(root, "wails-update-4242.log"),
		[]byte("bundle replacement failed"),
		0o600,
	))
	orphan := filepath.Join(root, "wails-update-orphan")
	require.NoError(t, os.Mkdir(orphan, 0o700))

	setup, err := prepareApplicationUpdateState(
		ApplicationUpdateOptions{TempRoot: root, StatePath: statePath},
		enabledApplicationUpdateBuild(),
	)

	require.NoError(t, err)
	require.NotNil(t, setup.Store)
	require.Equal(t, updatestate.OutcomeFailed, setup.Reconciled.Outcome)
	require.Equal(t, "bundle replacement failed", setup.Reconciled.HelperDiagnostic)
	require.Equal(t, "1.9.0", setup.SkippedVersion)
	require.NoDirExists(t, staging)
	require.NoDirExists(t, orphan)
	document, err := setup.Store.Load()
	require.NoError(t, err)
	require.Empty(t, document.ProtectedPaths())
}

func TestConfigureApplicationUpdatesProjectsAndLogsFailedApply(t *testing.T) {
	if runtime.GOARCH != "amd64" && runtime.GOARCH != "arm64" {
		t.Skip("updater supports amd64 and arm64")
	}
	distribution := updateidentity.DistributionLinuxPortable
	recovery := updateidentity.RecoveryLinuxPortableDownload
	switch runtime.GOOS {
	case "darwin":
		distribution = updateidentity.DistributionMacBundle
		recovery = updateidentity.RecoveryMacDownload
	case "windows":
		distribution = updateidentity.DistributionWindowsNSIS
		recovery = updateidentity.RecoveryWindowsDownload
	case "linux":
	default:
		t.Skip("updater is not supported on this platform")
	}

	originalVersion := Version
	originalBetaExpiry := BetaExpiry
	Version = "2.0.0-beta.3"
	BetaExpiry = ""
	t.Cleanup(func() {
		Version = originalVersion
		BetaExpiry = originalBetaExpiry
	})
	base := t.TempDir()
	root := filepath.Join(base, "owned-temp")
	statePath := filepath.Join(base, "config", "application-update.json")
	require.NoError(t, os.Mkdir(root, 0o700))
	store, err := updatestate.New(updatestate.Config{
		StatePath: statePath,
		TempRoot:  root,
		PID:       func() int { return 4242 },
	})
	require.NoError(t, err)
	staging := filepath.Join(root, "wails-update-failed")
	require.NoError(t, os.Mkdir(staging, 0o700))
	require.NoError(t, store.RecordPrepared(updatestate.PreparedUpdate{
		TargetVersion: "2.0.0", StagingDir: staging, RecoveryTarget: recovery,
	}))
	_, err = store.BeginAttempt(updatestate.AttemptMetadata{
		SourceVersion: Version, Platform: runtime.GOOS, Architecture: runtime.GOARCH,
		Distribution: distribution,
	})
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(
		filepath.Join(root, "wails-update-4242.log"),
		[]byte("replacement failed safely"),
		0o600,
	))
	app := newUpdateCoordinatorTestFixture(t)

	app.Updates.configureApplicationUpdates(ApplicationUpdateOptions{
		TempRoot: root, StatePath: statePath,
	})

	snapshot := app.Updates.coordinator.Snapshot()
	require.Equal(t, appupdates.StatusApplyError, snapshot.Status)
	require.Equal(t, "2.0.0", snapshot.AvailableVersion)
	require.Equal(t, distribution, snapshot.Distribution)
	require.Equal(t, recovery, snapshot.RecoveryTarget)
	require.Condition(t, func() bool {
		for _, entry := range app.AppLogs.logger.GetEntries() {
			if strings.Contains(entry.Message, "replacement failed safely") {
				return true
			}
		}
		return false
	})
}
