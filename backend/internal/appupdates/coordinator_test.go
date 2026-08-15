package appupdates_test

import (
	"context"
	"errors"
	"io"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/appupdates"
	"github.com/luxury-yacht/app/internal/updateidentity"
	"github.com/luxury-yacht/app/internal/updatestate"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/updater"
)

type fakeUpdater struct {
	initConfigs              []updater.Config
	checkCalls               int
	downloadCalls            int
	restartCalls             int
	release                  *updater.Release
	state                    updater.State
	checkStarted             chan struct{}
	allowCheck               chan struct{}
	checkStartOnce           sync.Once
	waitForCheckCancellation bool
	checkCanceled            chan struct{}
	downloadStarted          chan struct{}
	allowDownload            chan struct{}
	downloadStartOnce        sync.Once
	restartStarted           chan struct{}
	allowRestart             chan struct{}
	restartStartOnce         sync.Once
	checkErr                 error
	downloadErr              error
	restartErr               error
	downloadedPath           string
	skippedVersions          []string
	operationOrder           *[]string
}

type fakeUpdateState struct {
	prepared       *updatestate.PreparedUpdate
	attempt        *updatestate.UpdateAttempt
	recordErr      error
	beginErr       error
	restoreErr     error
	cleanupErr     error
	discardErr     error
	discarded      []string
	skipped        string
	skipErr        error
	cleanupCalls   int
	operationOrder *[]string
}

func signedRelease(version, channel, platform, architecture string) *updater.Release {
	return &updater.Release{
		Version:  version,
		Channel:  channel,
		Artifact: updater.Artifact{Platform: platform, Arch: architecture},
		Verification: &updater.Verification{
			DigestAlgo: "sha512", Digest: make([]byte, 64),
			SignatureAlgo: "ed25519ph", Signature: make([]byte, 64),
		},
	}
}

func testPublicKey() []byte {
	return make([]byte, 32)
}

func (client *fakeUpdater) Init(config updater.Config) error {
	client.initConfigs = append(client.initConfigs, config)
	client.state = updater.StateIdle
	return nil
}

func (client *fakeUpdater) Check(ctx context.Context) (*updater.Release, error) {
	client.checkCalls++
	if client.checkStarted != nil {
		client.checkStartOnce.Do(func() { close(client.checkStarted) })
	}
	if client.allowCheck != nil {
		if client.waitForCheckCancellation {
			select {
			case <-ctx.Done():
				if client.checkCanceled != nil {
					close(client.checkCanceled)
				}
				return nil, ctx.Err()
			case <-client.allowCheck:
			}
		} else {
			<-client.allowCheck
		}
	}
	if client.checkErr != nil {
		client.state = updater.StateError
		return nil, client.checkErr
	}
	if client.release == nil {
		client.state = updater.StateUpToDate
		return nil, nil
	}
	client.state = updater.StateAvailable
	return client.release, nil
}

func TestConcurrentCheckReportsExistingFlowWithoutQueuingAnotherCheck(t *testing.T) {
	t.Parallel()

	client := &fakeUpdater{
		release:      signedRelease("2.0.0", "beta", "darwin", "arm64"),
		checkStarted: make(chan struct{}),
		allowCheck:   make(chan struct{}),
	}
	coordinator := appupdates.New(appupdates.Dependencies{
		Client: client, Provider: fakeProvider{}, Eligibility: enabledBuild(),
		PublicKey: testPublicKey(), Platform: "darwin", Architecture: "arm64",
		TempRoot: "/owned/temp/root", Scheduler: &fakeScheduler{}, UpdateState: &fakeUpdateState{},
	})
	coordinator.RuntimeReady()

	firstDone := make(chan error, 1)
	go func() {
		_, err := coordinator.Check(context.Background())
		firstDone <- err
	}()
	<-client.checkStarted

	type checkResult struct {
		snapshot appupdates.Snapshot
		err      error
	}
	secondDone := make(chan checkResult, 1)
	go func() {
		snapshot, err := coordinator.Check(context.Background())
		secondDone <- checkResult{snapshot: snapshot, err: err}
	}()

	var second checkResult
	returnedWhileFirstActive := false
	select {
	case second = <-secondDone:
		returnedWhileFirstActive = true
	case <-time.After(100 * time.Millisecond):
	}
	close(client.allowCheck)
	require.NoError(t, <-firstDone)
	if !returnedWhileFirstActive {
		second = <-secondDone
	}

	require.True(t, returnedWhileFirstActive, "second check waited for the active provider call")
	require.NoError(t, second.err)
	require.Equal(t, appupdates.StatusChecking, second.snapshot.Status)
	require.Equal(t, 1, client.checkCalls)
}

func TestCheckDuringDownloadReportsActiveFlowWithoutQueuingCheck(t *testing.T) {
	t.Parallel()

	client := &fakeUpdater{
		release:         signedRelease("2.0.0", "beta", "darwin", "arm64"),
		downloadStarted: make(chan struct{}),
		allowDownload:   make(chan struct{}),
	}
	coordinator := appupdates.New(appupdates.Dependencies{
		Client: client, Provider: fakeProvider{}, Eligibility: enabledBuild(),
		PublicKey: testPublicKey(), Platform: "darwin", Architecture: "arm64",
		TempRoot: "/owned/temp/root", Scheduler: &fakeScheduler{}, UpdateState: &fakeUpdateState{},
	})
	coordinator.RuntimeReady()
	_, err := coordinator.Check(context.Background())
	require.NoError(t, err)

	downloadDone := make(chan error, 1)
	go func() {
		_, err := coordinator.Download(context.Background(), "2.0.0")
		downloadDone <- err
	}()
	<-client.downloadStarted

	type checkResult struct {
		snapshot appupdates.Snapshot
		err      error
	}
	checkDone := make(chan checkResult, 1)
	go func() {
		snapshot, err := coordinator.Check(context.Background())
		checkDone <- checkResult{snapshot: snapshot, err: err}
	}()

	var check checkResult
	returnedWhileDownloadActive := false
	select {
	case check = <-checkDone:
		returnedWhileDownloadActive = true
	case <-time.After(100 * time.Millisecond):
	}
	close(client.allowDownload)
	require.NoError(t, <-downloadDone)
	if !returnedWhileDownloadActive {
		check = <-checkDone
	}

	require.True(t, returnedWhileDownloadActive, "check waited for the active download")
	require.NoError(t, check.err)
	require.Equal(t, appupdates.StatusDownloading, check.snapshot.Status)
	require.Equal(t, 1, client.checkCalls)
	require.Equal(t, 1, client.downloadCalls)
}

func (client *fakeUpdater) DownloadAndInstall(context.Context) error {
	client.downloadCalls++
	if client.downloadStarted != nil {
		client.downloadStartOnce.Do(func() { close(client.downloadStarted) })
	}
	if client.allowDownload != nil {
		<-client.allowDownload
	}
	if client.downloadErr != nil {
		client.state = updater.StateError
		return client.downloadErr
	}
	client.state = updater.StateReady
	return nil
}

func (client *fakeUpdater) Restart(context.Context) error {
	client.restartCalls++
	if client.operationOrder != nil {
		*client.operationOrder = append(*client.operationOrder, "wails-restart")
	}
	if client.restartStarted != nil {
		client.restartStartOnce.Do(func() { close(client.restartStarted) })
	}
	if client.allowRestart != nil {
		<-client.allowRestart
	}
	return client.restartErr
}

func (client *fakeUpdater) State() updater.State { return client.state }

func (client *fakeUpdater) DownloadedPath() string {
	if client.downloadedPath != "" {
		return client.downloadedPath
	}
	return "/owned/temp/root/wails-update-test/payload"
}

func (client *fakeUpdater) SkipVersion(version string) {
	client.skippedVersions = append(client.skippedVersions, version)
}

func (state *fakeUpdateState) ResolveStagingDirectory(path string) (string, error) {
	return filepath.Dir(path), nil
}

func (state *fakeUpdateState) RecordPrepared(prepared updatestate.PreparedUpdate) error {
	if state.recordErr != nil {
		return state.recordErr
	}
	copy := prepared
	state.prepared = &copy
	return nil
}

func (state *fakeUpdateState) BeginAttempt(metadata updatestate.AttemptMetadata) (updatestate.UpdateAttempt, error) {
	if state.operationOrder != nil {
		*state.operationOrder = append(*state.operationOrder, "persist-attempt")
	}
	if state.beginErr != nil {
		return updatestate.UpdateAttempt{}, state.beginErr
	}
	if state.prepared == nil {
		return updatestate.UpdateAttempt{}, errors.New("missing prepared update")
	}
	attempt := updatestate.UpdateAttempt{
		SourceVersion: metadata.SourceVersion, TargetVersion: state.prepared.TargetVersion,
		Platform: metadata.Platform, Architecture: metadata.Architecture,
		Distribution: metadata.Distribution, StagingDir: state.prepared.StagingDir,
		RecoveryTarget: state.prepared.RecoveryTarget,
	}
	state.prepared = nil
	state.attempt = &attempt
	return attempt, nil
}

func (state *fakeUpdateState) RestorePrepared() error {
	if state.restoreErr != nil {
		return state.restoreErr
	}
	if state.attempt == nil {
		return errors.New("missing attempt")
	}
	state.prepared = &updatestate.PreparedUpdate{
		TargetVersion:  state.attempt.TargetVersion,
		StagingDir:     state.attempt.StagingDir,
		RecoveryTarget: state.attempt.RecoveryTarget,
	}
	state.attempt = nil
	return nil
}

func (state *fakeUpdateState) CleanupPrepared() error {
	state.cleanupCalls++
	state.prepared = nil
	return state.cleanupErr
}

func (state *fakeUpdateState) DiscardStaging(path string) error {
	state.discarded = append(state.discarded, path)
	return state.discardErr
}

func (state *fakeUpdateState) SetSkippedVersion(version string) error {
	if state.skipErr != nil {
		return state.skipErr
	}
	state.skipped = version
	return nil
}

type fakeProvider struct{}

func (fakeProvider) Name() string { return "fake" }
func (fakeProvider) Check(context.Context, updater.CheckRequest) (*updater.Release, error) {
	return nil, nil
}
func (fakeProvider) Download(context.Context, *updater.Release, io.Writer, func(int64, int64)) error {
	return nil
}

type fakeScheduler struct {
	startCalls int
	stopCalls  int
	interval   time.Duration
	run        func(context.Context)
}

func (scheduler *fakeScheduler) Start(interval time.Duration, run func(context.Context)) {
	scheduler.startCalls++
	scheduler.interval = interval
	scheduler.run = run
}

func (scheduler *fakeScheduler) Stop() { scheduler.stopCalls++ }

func enabledBuild() updateidentity.BuildEligibility {
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

func newTestCoordinator(
	client *fakeUpdater,
	eligibility updateidentity.BuildEligibility,
	platform string,
	architecture string,
) *appupdates.Coordinator {
	return appupdates.New(appupdates.Dependencies{
		Client: client, Provider: fakeProvider{}, Eligibility: eligibility,
		PublicKey: testPublicKey(), Platform: platform, Architecture: architecture,
		TempRoot: "/owned/temp/root", Scheduler: &fakeScheduler{}, UpdateState: &fakeUpdateState{},
	})
}

func TestNewInitializesEligibleUpdaterOnceBeforeManualCheck(t *testing.T) {
	t.Parallel()

	client := &fakeUpdater{release: signedRelease("2.0.0", "beta", "darwin", "arm64")}
	coordinator := appupdates.New(appupdates.Dependencies{
		Client: client, Provider: fakeProvider{}, Eligibility: enabledBuild(),
		PublicKey: testPublicKey(), Platform: "darwin", Architecture: "arm64",
		TempRoot: "/owned/temp/root", Scheduler: &fakeScheduler{}, UpdateState: &fakeUpdateState{},
	})

	require.Len(t, client.initConfigs, 1)
	config := client.initConfigs[0]
	require.Equal(t, "2.0.0-beta.3", config.CurrentVersion)
	require.Equal(t, "darwin", config.Platform)
	require.Equal(t, "arm64", config.Arch)
	require.Zero(t, config.CheckInterval)
	require.Equal(t, updater.WindowNone, config.Window)
	require.Len(t, config.Providers, 1)
	require.Equal(t, testPublicKey(), config.PublicKey)
	require.Zero(t, client.checkCalls)
	require.Zero(t, client.downloadCalls)

	coordinator.RuntimeReady()
	snapshot, err := coordinator.Check(context.Background())

	require.NoError(t, err)
	require.Equal(t, 1, client.checkCalls)
	require.Zero(t, client.downloadCalls)
	require.Equal(t, appupdates.StatusAvailable, snapshot.Status)
	require.Equal(t, "2.0.0", snapshot.AvailableVersion)
}

func TestMissingDurableStateKeepsChecksButDisablesInstallation(t *testing.T) {
	t.Parallel()

	client := &fakeUpdater{release: signedRelease("2.0.0", "beta", "darwin", "arm64")}
	coordinator := appupdates.New(appupdates.Dependencies{
		Client: client, Provider: fakeProvider{}, Eligibility: enabledBuild(),
		PublicKey: testPublicKey(), Platform: "darwin", Architecture: "arm64",
		TempRoot: "/owned/temp/root", Scheduler: &fakeScheduler{},
	})
	coordinator.RuntimeReady()

	snapshot, err := coordinator.Check(context.Background())
	require.NoError(t, err)
	require.Equal(t, appupdates.StatusAvailable, snapshot.Status)
	require.True(t, snapshot.CanCheck)
	require.False(t, snapshot.CanInstall)

	_, err = coordinator.Download(context.Background(), "2.0.0")
	require.ErrorContains(t, err, "not eligible for automatic installation")
	require.Zero(t, client.downloadCalls)
}

func TestSkippedVersionHydratesBeforeFirstCheckAndPersistsBeforeHidingRelease(t *testing.T) {
	t.Parallel()

	client := &fakeUpdater{release: signedRelease("2.0.0", "beta", "darwin", "arm64")}
	state := &fakeUpdateState{}
	coordinator := appupdates.New(appupdates.Dependencies{
		Client: client, Provider: fakeProvider{}, Eligibility: enabledBuild(),
		PublicKey: testPublicKey(), Platform: "darwin", Architecture: "arm64",
		TempRoot: "/owned/temp/root", Scheduler: &fakeScheduler{}, UpdateState: state,
		SkippedVersion: "1.9.0",
	})
	require.Equal(t, []string{"1.9.0"}, client.skippedVersions)
	coordinator.RuntimeReady()
	_, err := coordinator.Check(context.Background())
	require.NoError(t, err)

	snapshot, err := coordinator.Skip(context.Background(), "2.0.0")

	require.NoError(t, err)
	require.Equal(t, "2.0.0", state.skipped)
	require.Equal(t, []string{"1.9.0", "2.0.0"}, client.skippedVersions)
	require.Equal(t, appupdates.StatusCurrent, snapshot.Status)
	require.Empty(t, snapshot.AvailableVersion)
	_, err = coordinator.Download(context.Background(), "2.0.0")
	require.ErrorContains(t, err, "pending release")
}

func TestSkippedVersionPersistenceFailureLeavesReleaseAvailable(t *testing.T) {
	t.Parallel()

	client := &fakeUpdater{release: signedRelease("2.0.0", "beta", "darwin", "arm64")}
	state := &fakeUpdateState{skipErr: errors.New("state disk unavailable")}
	coordinator := appupdates.New(appupdates.Dependencies{
		Client: client, Provider: fakeProvider{}, Eligibility: enabledBuild(),
		PublicKey: testPublicKey(), Platform: "darwin", Architecture: "arm64",
		TempRoot: "/owned/temp/root", Scheduler: &fakeScheduler{}, UpdateState: state,
	})
	coordinator.RuntimeReady()
	_, err := coordinator.Check(context.Background())
	require.NoError(t, err)

	snapshot, err := coordinator.Skip(context.Background(), "2.0.0")

	require.ErrorContains(t, err, "state disk unavailable")
	require.Equal(t, appupdates.StatusAvailable, snapshot.Status)
	require.Equal(t, "state disk unavailable", snapshot.Error)
	require.Empty(t, client.skippedVersions)
}

func TestFailedStartupReconciliationBlocksChecksAndUsesPersistedRecoveryIdentity(t *testing.T) {
	t.Parallel()

	client := &fakeUpdater{}
	scheduler := &fakeScheduler{}
	reconciled := updatestate.ReconcileResult{
		Outcome:        updatestate.OutcomeFailed,
		SourceVersion:  "2.0.0-beta.3",
		TargetVersion:  "2.0.0",
		Distribution:   updateidentity.DistributionMacBundle,
		RecoveryTarget: updateidentity.RecoveryMacDownload,
	}
	coordinator := appupdates.New(appupdates.Dependencies{
		Client: client, Provider: fakeProvider{}, Eligibility: enabledBuild(),
		PublicKey: testPublicKey(), Platform: "darwin", Architecture: "arm64",
		TempRoot: "/owned/temp/root", Scheduler: scheduler,
		UpdateState: &fakeUpdateState{}, Reconciled: &reconciled,
	})
	coordinator.RuntimeReady()

	snapshot, err := coordinator.Check(context.Background())

	require.NoError(t, err)
	require.Equal(t, appupdates.StatusApplyError, snapshot.Status)
	require.Equal(t, "2.0.0-beta.3", snapshot.CurrentVersion)
	require.Equal(t, "2.0.0", snapshot.AvailableVersion)
	require.Equal(t, updateidentity.DistributionMacBundle, snapshot.Distribution)
	require.Equal(t, updateidentity.RecoveryMacDownload, snapshot.RecoveryTarget)
	require.False(t, snapshot.CanCheck)
	require.False(t, snapshot.CanInstall)
	require.Zero(t, client.checkCalls)
	require.Zero(t, scheduler.startCalls)
}

func TestNewRejectsMalformedPublicKeyBeforeInitializingWails(t *testing.T) {
	t.Parallel()

	client := &fakeUpdater{}
	coordinator := appupdates.New(appupdates.Dependencies{
		Client: client, Provider: fakeProvider{}, Eligibility: enabledBuild(),
		PublicKey: []byte("not-an-ed25519-public-key"), Platform: "darwin", Architecture: "arm64",
		TempRoot: "/owned/temp/root", Scheduler: &fakeScheduler{},
	})

	require.Empty(t, client.initConfigs)
	snapshot := coordinator.Snapshot()
	require.Equal(t, appupdates.StatusDisabled, snapshot.Status)
	require.False(t, snapshot.CanCheck)
	require.False(t, snapshot.CanInstall)
	require.ErrorContains(t, errors.New(snapshot.Error), "public key")
}

func TestDisabledBuildNeverCallsUpdater(t *testing.T) {
	t.Parallel()

	for _, status := range []updateidentity.BuildStatus{
		updateidentity.BuildDisabledDevelopment,
		updateidentity.BuildDisabledServer,
		updateidentity.BuildDisabledInvalidVersion,
		updateidentity.BuildDisabledInstallation,
		updateidentity.BuildExpiredBeta,
	} {
		t.Run(string(status), func(t *testing.T) {
			t.Parallel()

			client := &fakeUpdater{}
			coordinator := appupdates.New(appupdates.Dependencies{
				Client: client, Provider: fakeProvider{},
				Eligibility: updateidentity.BuildEligibility{Status: status},
				PublicKey:   testPublicKey(), Platform: "darwin", Architecture: "arm64",
				TempRoot: "/owned/temp/root", Scheduler: &fakeScheduler{},
			})
			coordinator.RuntimeReady()

			snapshot, err := coordinator.Check(context.Background())

			require.NoError(t, err)
			require.Equal(t, appupdates.StatusDisabled, snapshot.Status)
			require.Empty(t, client.initConfigs)
			require.Zero(t, client.checkCalls)
			require.Zero(t, client.downloadCalls)
			require.Zero(t, client.restartCalls)
		})
	}
}

func TestDownloadAndRestartRequireExplicitValidTransitions(t *testing.T) {
	t.Parallel()

	client := &fakeUpdater{release: signedRelease("2.0.0", "beta", "darwin", "arm64")}
	coordinator := appupdates.New(appupdates.Dependencies{
		Client: client, Provider: fakeProvider{}, Eligibility: enabledBuild(),
		PublicKey: testPublicKey(), Platform: "darwin", Architecture: "arm64",
		TempRoot: "/owned/temp/root", Scheduler: &fakeScheduler{}, UpdateState: &fakeUpdateState{},
	})
	coordinator.RuntimeReady()

	_, err := coordinator.Download(context.Background(), "2.0.0")
	require.ErrorContains(t, err, "pending release")
	_, err = coordinator.Restart(context.Background())
	require.ErrorContains(t, err, "ready update")
	require.Zero(t, client.downloadCalls)
	require.Zero(t, client.restartCalls)

	_, err = coordinator.Check(context.Background())
	require.NoError(t, err)
	_, err = coordinator.Download(context.Background(), "2.0.1")
	require.ErrorContains(t, err, "does not match pending release")
	require.Zero(t, client.downloadCalls)

	snapshot, err := coordinator.Download(context.Background(), "2.0.0")
	require.NoError(t, err)
	require.Equal(t, appupdates.StatusReady, snapshot.Status)
	require.Equal(t, 1, client.downloadCalls)
	require.Zero(t, client.restartCalls)

	snapshot, err = coordinator.Restart(context.Background())
	require.NoError(t, err)
	require.Equal(t, appupdates.StatusReady, snapshot.Status)
	require.Equal(t, 1, client.restartCalls)
}

func TestConcurrentRestartStartsOneHelperFlow(t *testing.T) {
	t.Parallel()

	client := &fakeUpdater{
		release:        signedRelease("2.0.0", "beta", "darwin", "arm64"),
		restartStarted: make(chan struct{}),
		allowRestart:   make(chan struct{}),
	}
	coordinator := appupdates.New(appupdates.Dependencies{
		Client: client, Provider: fakeProvider{}, Eligibility: enabledBuild(),
		PublicKey: testPublicKey(), Platform: "darwin", Architecture: "arm64",
		TempRoot: "/owned/temp/root", Scheduler: &fakeScheduler{}, UpdateState: &fakeUpdateState{},
	})
	coordinator.RuntimeReady()
	_, err := coordinator.Check(context.Background())
	require.NoError(t, err)
	_, err = coordinator.Download(context.Background(), "2.0.0")
	require.NoError(t, err)

	firstDone := make(chan error, 1)
	go func() {
		_, err := coordinator.Restart(context.Background())
		firstDone <- err
	}()
	<-client.restartStarted

	type restartResult struct {
		snapshot appupdates.Snapshot
		err      error
	}
	secondDone := make(chan restartResult, 1)
	go func() {
		snapshot, err := coordinator.Restart(context.Background())
		secondDone <- restartResult{snapshot: snapshot, err: err}
	}()

	var second restartResult
	returnedWhileFirstActive := false
	select {
	case second = <-secondDone:
		returnedWhileFirstActive = true
	case <-time.After(100 * time.Millisecond):
	}
	close(client.allowRestart)
	require.NoError(t, <-firstDone)
	if !returnedWhileFirstActive {
		second = <-secondDone
	}

	require.True(t, returnedWhileFirstActive, "second restart waited for the active helper spawn")
	require.NoError(t, second.err)
	require.Equal(t, appupdates.StatusReady, second.snapshot.Status)
	require.Equal(t, 1, client.restartCalls)
}

func TestOperationFailuresMapToRetryableSemanticStates(t *testing.T) {
	t.Parallel()

	t.Run("check", func(t *testing.T) {
		client := &fakeUpdater{checkErr: errors.New("network unavailable")}
		coordinator := newTestCoordinator(client, enabledBuild(), "darwin", "arm64")
		coordinator.RuntimeReady()

		snapshot, err := coordinator.Check(context.Background())

		require.EqualError(t, err, "network unavailable")
		require.Equal(t, appupdates.StatusCheckError, snapshot.Status)
		require.Equal(t, "network unavailable", snapshot.Error)
	})

	t.Run("download", func(t *testing.T) {
		client := &fakeUpdater{
			release:     signedRelease("2.0.0", "beta", "darwin", "arm64"),
			downloadErr: errors.New("signature rejected"),
		}
		coordinator := newTestCoordinator(client, enabledBuild(), "darwin", "arm64")
		coordinator.RuntimeReady()
		_, err := coordinator.Check(context.Background())
		require.NoError(t, err)

		snapshot, err := coordinator.Download(context.Background(), "2.0.0")

		require.EqualError(t, err, "signature rejected")
		require.Equal(t, appupdates.StatusPrepareError, snapshot.Status)
		require.Equal(t, "signature rejected", snapshot.Error)

		client.downloadErr = nil
		snapshot, err = coordinator.Download(context.Background(), "2.0.0")
		require.NoError(t, err)
		require.Equal(t, appupdates.StatusReady, snapshot.Status)
		require.Empty(t, snapshot.Error)
		require.Equal(t, 2, client.downloadCalls)
	})

	t.Run("restart can retry", func(t *testing.T) {
		client := &fakeUpdater{
			release:    signedRelease("2.0.0", "beta", "darwin", "arm64"),
			restartErr: errors.New("helper did not start"),
		}
		coordinator := newTestCoordinator(client, enabledBuild(), "darwin", "arm64")
		coordinator.RuntimeReady()
		_, err := coordinator.Check(context.Background())
		require.NoError(t, err)
		_, err = coordinator.Download(context.Background(), "2.0.0")
		require.NoError(t, err)

		snapshot, err := coordinator.Restart(context.Background())
		require.EqualError(t, err, "helper did not start")
		require.Equal(t, appupdates.StatusRestartError, snapshot.Status)
		client.restartErr = nil

		snapshot, err = coordinator.Restart(context.Background())
		require.NoError(t, err)
		require.Equal(t, appupdates.StatusReady, snapshot.Status)
		require.Empty(t, snapshot.Error)
		require.Equal(t, 2, client.restartCalls)
	})
}

func TestReadyRequiresPersistedPreparedOwnership(t *testing.T) {
	t.Parallel()

	client := &fakeUpdater{
		release:        signedRelease("2.0.0", "beta", "darwin", "arm64"),
		downloadedPath: "/owned/temp/root/wails-update-owned/Luxury Yacht.app",
	}
	state := &fakeUpdateState{}
	coordinator := appupdates.New(appupdates.Dependencies{
		Client: client, Provider: fakeProvider{}, Eligibility: enabledBuild(),
		PublicKey: testPublicKey(), Platform: "darwin", Architecture: "arm64",
		TempRoot: "/owned/temp/root", Scheduler: &fakeScheduler{}, UpdateState: state,
	})
	coordinator.RuntimeReady()
	_, err := coordinator.Check(context.Background())
	require.NoError(t, err)

	snapshot, err := coordinator.Download(context.Background(), "2.0.0")

	require.NoError(t, err)
	require.Equal(t, appupdates.StatusReady, snapshot.Status)
	require.Equal(t, &updatestate.PreparedUpdate{
		TargetVersion:  "2.0.0",
		StagingDir:     "/owned/temp/root/wails-update-owned",
		RecoveryTarget: updateidentity.RecoveryMacDownload,
	}, state.prepared)
}

func TestPreparedPersistenceFailureBlocksReadyAndDiscardsExactStaging(t *testing.T) {
	t.Parallel()

	client := &fakeUpdater{
		release:        signedRelease("2.0.0", "beta", "darwin", "arm64"),
		downloadedPath: "/owned/temp/root/wails-update-unrecorded/Luxury Yacht.app",
	}
	state := &fakeUpdateState{recordErr: errors.New("state disk unavailable")}
	coordinator := appupdates.New(appupdates.Dependencies{
		Client: client, Provider: fakeProvider{}, Eligibility: enabledBuild(),
		PublicKey: testPublicKey(), Platform: "darwin", Architecture: "arm64",
		TempRoot: "/owned/temp/root", Scheduler: &fakeScheduler{}, UpdateState: state,
	})
	coordinator.RuntimeReady()
	_, err := coordinator.Check(context.Background())
	require.NoError(t, err)

	snapshot, err := coordinator.Download(context.Background(), "2.0.0")

	require.ErrorContains(t, err, "state disk unavailable")
	require.Equal(t, appupdates.StatusPrepareError, snapshot.Status)
	require.Equal(t, []string{"/owned/temp/root/wails-update-unrecorded"}, state.discarded)
}

func TestRestartPersistsAttemptBeforeWailsAndRestoresPreparedOnSpawnFailure(t *testing.T) {
	t.Parallel()

	var operationOrder []string
	client := &fakeUpdater{
		release:    signedRelease("2.0.0", "beta", "darwin", "arm64"),
		restartErr: errors.New("helper did not start"), operationOrder: &operationOrder,
	}
	state := &fakeUpdateState{operationOrder: &operationOrder}
	coordinator := appupdates.New(appupdates.Dependencies{
		Client: client, Provider: fakeProvider{}, Eligibility: enabledBuild(),
		PublicKey: testPublicKey(), Platform: "darwin", Architecture: "arm64",
		TempRoot: "/owned/temp/root", Scheduler: &fakeScheduler{}, UpdateState: state,
	})
	coordinator.RuntimeReady()
	_, err := coordinator.Check(context.Background())
	require.NoError(t, err)
	_, err = coordinator.Download(context.Background(), "2.0.0")
	require.NoError(t, err)

	snapshot, err := coordinator.Restart(context.Background())

	require.EqualError(t, err, "helper did not start")
	require.Equal(t, []string{"persist-attempt", "wails-restart"}, operationOrder)
	require.Equal(t, appupdates.StatusRestartError, snapshot.Status)
	require.NotNil(t, state.prepared)
	require.Nil(t, state.attempt)
}

func TestRestartPersistenceFailureNeverStartsWailsHelper(t *testing.T) {
	t.Parallel()

	client := &fakeUpdater{release: signedRelease("2.0.0", "beta", "darwin", "arm64")}
	state := &fakeUpdateState{beginErr: errors.New("state disk unavailable")}
	coordinator := appupdates.New(appupdates.Dependencies{
		Client: client, Provider: fakeProvider{}, Eligibility: enabledBuild(),
		PublicKey: testPublicKey(), Platform: "darwin", Architecture: "arm64",
		TempRoot: "/owned/temp/root", Scheduler: &fakeScheduler{}, UpdateState: state,
	})
	coordinator.RuntimeReady()
	_, err := coordinator.Check(context.Background())
	require.NoError(t, err)
	_, err = coordinator.Download(context.Background(), "2.0.0")
	require.NoError(t, err)

	snapshot, err := coordinator.Restart(context.Background())

	require.ErrorContains(t, err, "state disk unavailable")
	require.Equal(t, appupdates.StatusRestartError, snapshot.Status)
	require.Zero(t, client.restartCalls)
}

func TestStopCleansPreparedDownloadUnlessRestartTransferredOwnership(t *testing.T) {
	t.Parallel()

	t.Run("normal shutdown", func(t *testing.T) {
		client := &fakeUpdater{release: signedRelease("2.0.0", "beta", "darwin", "arm64")}
		state := &fakeUpdateState{}
		coordinator := appupdates.New(appupdates.Dependencies{
			Client: client, Provider: fakeProvider{}, Eligibility: enabledBuild(),
			PublicKey: testPublicKey(), Platform: "darwin", Architecture: "arm64",
			TempRoot: "/owned/temp/root", Scheduler: &fakeScheduler{}, UpdateState: state,
		})
		coordinator.RuntimeReady()
		_, err := coordinator.Check(context.Background())
		require.NoError(t, err)
		_, err = coordinator.Download(context.Background(), "2.0.0")
		require.NoError(t, err)

		coordinator.Stop()

		require.Equal(t, 1, state.cleanupCalls)
		require.Nil(t, state.prepared)
	})

	t.Run("restart handoff", func(t *testing.T) {
		client := &fakeUpdater{release: signedRelease("2.0.0", "beta", "darwin", "arm64")}
		state := &fakeUpdateState{}
		coordinator := appupdates.New(appupdates.Dependencies{
			Client: client, Provider: fakeProvider{}, Eligibility: enabledBuild(),
			PublicKey: testPublicKey(), Platform: "darwin", Architecture: "arm64",
			TempRoot: "/owned/temp/root", Scheduler: &fakeScheduler{}, UpdateState: state,
		})
		coordinator.RuntimeReady()
		_, err := coordinator.Check(context.Background())
		require.NoError(t, err)
		_, err = coordinator.Download(context.Background(), "2.0.0")
		require.NoError(t, err)
		_, err = coordinator.Restart(context.Background())
		require.NoError(t, err)

		coordinator.Stop()

		require.Zero(t, state.cleanupCalls)
		require.NotNil(t, state.attempt)
	})
}

func TestStopCleansPreparedStateRecordedAfterTheInitialShutdownCleanup(t *testing.T) {
	t.Parallel()

	client := &fakeUpdater{
		release:         signedRelease("2.0.0", "beta", "darwin", "arm64"),
		downloadStarted: make(chan struct{}),
		allowDownload:   make(chan struct{}),
	}
	state := &fakeUpdateState{}
	coordinator := appupdates.New(appupdates.Dependencies{
		Client: client, Provider: fakeProvider{}, Eligibility: enabledBuild(),
		PublicKey: testPublicKey(), Platform: "darwin", Architecture: "arm64",
		TempRoot: "/owned/temp/root", Scheduler: &fakeScheduler{}, UpdateState: state,
	})
	coordinator.RuntimeReady()
	_, err := coordinator.Check(context.Background())
	require.NoError(t, err)

	downloadDone := make(chan error, 1)
	go func() {
		_, downloadErr := coordinator.Download(context.Background(), "2.0.0")
		downloadDone <- downloadErr
	}()
	<-client.downloadStarted

	coordinator.Stop()
	close(client.allowDownload)
	<-downloadDone

	require.Nil(t, state.prepared)
	require.Equal(t, 2, state.cleanupCalls)
}

func TestCheckPreservesPendingAndReadyRelease(t *testing.T) {
	t.Parallel()

	client := &fakeUpdater{release: signedRelease("2.0.0", "beta", "darwin", "arm64")}
	coordinator := newTestCoordinator(client, enabledBuild(), "darwin", "arm64")
	coordinator.RuntimeReady()

	available, err := coordinator.Check(context.Background())
	require.NoError(t, err)
	client.release.Version = "2.1.0"

	stillAvailable, err := coordinator.Check(context.Background())
	require.NoError(t, err)
	require.Equal(t, available, stillAvailable)
	require.Equal(t, 1, client.checkCalls)

	ready, err := coordinator.Download(context.Background(), "2.0.0")
	require.NoError(t, err)
	stillReady, err := coordinator.Check(context.Background())
	require.NoError(t, err)
	require.Equal(t, ready, stillReady)
	require.Equal(t, 1, client.checkCalls)
}

func TestCheckRejectsReleaseWithoutRequiredPinnedSignature(t *testing.T) {
	t.Parallel()

	validVerification := updater.Verification{
		DigestAlgo: "sha512", Digest: make([]byte, 64),
		SignatureAlgo: "ed25519ph", Signature: make([]byte, 64),
	}
	for _, test := range []struct {
		name         string
		verification *updater.Verification
	}{
		{name: "missing verification"},
		{name: "digest only", verification: &updater.Verification{
			DigestAlgo: "sha512", Digest: make([]byte, 64),
		}},
		{name: "wrong signature algorithm", verification: &updater.Verification{
			DigestAlgo: "sha512", Digest: make([]byte, 64),
			SignatureAlgo: "ed25519", Signature: make([]byte, 64),
		}},
		{name: "missing digest", verification: &updater.Verification{
			SignatureAlgo: "ed25519ph", Signature: make([]byte, 64),
		}},
		{name: "short signature", verification: &updater.Verification{
			DigestAlgo: "sha512", Digest: make([]byte, 64),
			SignatureAlgo: "ed25519ph", Signature: []byte("short"),
		}},
		{name: "short digest", verification: &updater.Verification{
			DigestAlgo: "sha512", Digest: []byte("short"),
			SignatureAlgo: "ed25519ph", Signature: make([]byte, 64),
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			client := &fakeUpdater{release: &updater.Release{
				Version: "2.0.0", Channel: "beta",
				Artifact:     updater.Artifact{Platform: "darwin", Arch: "arm64"},
				Verification: test.verification,
			}}
			coordinator := newTestCoordinator(client, enabledBuild(), "darwin", "arm64")
			coordinator.RuntimeReady()

			snapshot, err := coordinator.Check(context.Background())

			require.ErrorContains(t, err, "authenticated sha512/ed25519ph verification")
			require.Equal(t, appupdates.StatusCheckError, snapshot.Status)
			require.Empty(t, snapshot.AvailableVersion)
		})
	}

	client := &fakeUpdater{release: &updater.Release{
		Version: "2.0.0", Channel: "beta",
		Artifact:     updater.Artifact{Platform: "darwin", Arch: "arm64"},
		Verification: &validVerification,
	}}
	coordinator := newTestCoordinator(client, enabledBuild(), "darwin", "arm64")
	coordinator.RuntimeReady()
	snapshot, err := coordinator.Check(context.Background())
	require.NoError(t, err)
	require.Equal(t, appupdates.StatusAvailable, snapshot.Status)
}

func TestNotificationOnlyDistributionCanCheckButCannotDownload(t *testing.T) {
	t.Parallel()

	eligibility := enabledBuild()
	eligibility.Installation = updateidentity.InstallationEligibility{
		CanCheck: true, Distribution: updateidentity.DistributionLinuxDEB,
		Reason: updateidentity.ReasonLinuxPackageManaged, Recovery: updateidentity.RecoveryLinuxPackages,
	}
	eligibility.CanInstall = false
	client := &fakeUpdater{release: signedRelease("2.0.0", "beta", "linux", "amd64")}
	coordinator := appupdates.New(appupdates.Dependencies{
		Client: client, Provider: fakeProvider{}, Eligibility: eligibility,
		PublicKey: testPublicKey(), Platform: "linux", Architecture: "amd64",
		TempRoot: "/owned/temp/root", Scheduler: &fakeScheduler{},
	})
	coordinator.RuntimeReady()

	snapshot, err := coordinator.Check(context.Background())
	require.NoError(t, err)
	require.Equal(t, appupdates.StatusAvailable, snapshot.Status)

	_, err = coordinator.Download(context.Background(), "2.0.0")
	require.ErrorContains(t, err, "not eligible for automatic installation")
	require.Zero(t, client.downloadCalls)
}

func TestRuntimeReadyStartsImmediateAndPeriodicChecksOnceAndStopCancelsScheduler(t *testing.T) {
	t.Parallel()

	client := &fakeUpdater{}
	scheduler := &fakeScheduler{}
	coordinator := appupdates.New(appupdates.Dependencies{
		Client: client, Provider: fakeProvider{}, Eligibility: enabledBuild(),
		PublicKey: testPublicKey(), Platform: "darwin", Architecture: "arm64",
		TempRoot: "/owned/temp/root", Scheduler: scheduler,
	})

	coordinator.RuntimeReady()
	coordinator.RuntimeReady()

	require.Equal(t, 1, scheduler.startCalls)
	require.Equal(t, 6*time.Hour, scheduler.interval)
	require.NotNil(t, scheduler.run)
	require.Zero(t, client.checkCalls)

	scheduler.run(context.Background())
	require.Equal(t, 1, client.checkCalls)
	require.Zero(t, client.downloadCalls)
	scheduler.run(context.Background())
	require.Equal(t, 2, client.checkCalls)
	require.Zero(t, client.downloadCalls)

	coordinator.Stop()
	require.Equal(t, 1, scheduler.stopCalls)
}

func TestStopCancelsInProgressOperation(t *testing.T) {
	t.Parallel()

	client := &fakeUpdater{
		checkStarted:             make(chan struct{}),
		allowCheck:               make(chan struct{}),
		waitForCheckCancellation: true,
		checkCanceled:            make(chan struct{}),
	}
	coordinator := appupdates.New(appupdates.Dependencies{
		Client: client, Provider: fakeProvider{}, Eligibility: enabledBuild(),
		PublicKey: testPublicKey(), Platform: "darwin", Architecture: "arm64",
		TempRoot: "/owned/temp/root", Scheduler: &fakeScheduler{},
	})
	coordinator.RuntimeReady()

	checkDone := make(chan error, 1)
	go func() {
		_, err := coordinator.Check(context.Background())
		checkDone <- err
	}()
	<-client.checkStarted

	coordinator.Stop()

	select {
	case <-client.checkCanceled:
	case <-time.After(100 * time.Millisecond):
		close(client.allowCheck)
		t.Fatal("coordinator stop did not cancel the active check")
	}
	require.ErrorIs(t, <-checkDone, context.Canceled)
}
