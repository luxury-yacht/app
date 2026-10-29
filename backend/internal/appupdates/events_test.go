package appupdates_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/appupdates"
	"github.com/luxury-yacht/app/internal/updateidentity"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/updater"
)

// Wails emits lifecycle events from inside Check and DownloadAndInstall, so
// these helpers emit while the fake updater call is blocked mid-operation.
func whileBlocked(t *testing.T, started <-chan struct{}, allow chan struct{}, operation, emit func()) {
	t.Helper()
	done := make(chan struct{})
	go func() {
		defer close(done)
		operation()
	}()
	<-started
	emit()
	close(allow)
	<-done
}

func duringCheck(t *testing.T, client *fakeUpdater, check, emit func()) {
	t.Helper()
	client.checkStarted, client.allowCheck = make(chan struct{}), make(chan struct{})
	whileBlocked(t, client.checkStarted, client.allowCheck, check, emit)
}

func duringDownload(t *testing.T, coordinator *appupdates.Coordinator, client *fakeUpdater, emit func()) {
	t.Helper()
	client.downloadStarted, client.allowDownload = make(chan struct{}), make(chan struct{})
	whileBlocked(t, client.downloadStarted, client.allowDownload, func() {
		_, _ = coordinator.Download(context.Background(), client.release.Version)
	}, emit)
}

// newCheckedCoordinator returns a runtime-ready coordinator whose manual check
// already found client's release, so a download can start.
func newCheckedCoordinator(t *testing.T, client *fakeUpdater, onChange func(appupdates.Snapshot)) *appupdates.Coordinator {
	t.Helper()
	coordinator := appupdates.New(appupdates.Dependencies{
		Client: client, Provider: fakeProvider{}, Eligibility: enabledBuild(),
		PublicKey: testPublicKey(), Platform: "darwin", Architecture: "arm64",
		TempRoot: "/owned/temp/root", Scheduler: &fakeScheduler{}, UpdateState: &fakeUpdateState{},
		OnChange: onChange,
	})
	coordinator.RuntimeReady()
	_, err := coordinator.Check(context.Background())
	require.NoError(t, err)
	return coordinator
}

func TestWailsEventsPublishCompleteApplicationSnapshot(t *testing.T) {
	t.Parallel()

	publishedAt := time.Date(2026, time.August, 14, 12, 30, 0, 0, time.UTC)
	release := signedRelease("2.0.0", "stable", "darwin", "arm64")
	release.Name = "Luxury Yacht 2.0.0"
	release.Notes = "## Safer updates"
	release.PublishedAt = publishedAt
	client := &fakeUpdater{release: release}
	var published []appupdates.Snapshot
	coordinator := appupdates.New(appupdates.Dependencies{
		Client: client, Provider: fakeProvider{}, Eligibility: enabledBuild(),
		PublicKey: testPublicKey(), Platform: "darwin", Architecture: "arm64",
		TempRoot: "/owned/temp/root", Scheduler: &fakeScheduler{}, UpdateState: &fakeUpdateState{},
		OnChange: func(snapshot appupdates.Snapshot) {
			published = append(published, snapshot)
		},
	})
	coordinator.RuntimeReady()
	var snapshot appupdates.Snapshot

	duringCheck(t, client, func() { _, _ = coordinator.Check(context.Background()) }, func() {
		snapshot = coordinator.HandleWailsEvent(updater.EventUpdateAvailable, release)
	})

	require.Equal(t, appupdates.Snapshot{
		Revision:          2,
		Status:            appupdates.StatusAvailable,
		CurrentVersion:    "2.0.0-beta.3",
		AvailableVersion:  "2.0.0",
		ReleaseName:       "Luxury Yacht 2.0.0",
		PublishedAt:       publishedAt.Format(time.RFC3339),
		ReleaseNotes:      "## Safer updates",
		CanCheck:          true,
		CanInstall:        true,
		Distribution:      updateidentity.DistributionMacBundle,
		EligibilityReason: "",
		RecoveryTarget:    "",
	}, snapshot)
	require.Equal(t, []appupdates.Status{appupdates.StatusChecking, appupdates.StatusAvailable}, publishedStatuses(published))
	require.Equal(t, snapshot, published[1])
	require.Equal(t, snapshot, coordinator.Snapshot())
}

func TestCoordinatorOperationsPublishCommandOwnedTransitions(t *testing.T) {
	t.Parallel()

	client := &fakeUpdater{release: signedRelease("2.0.0", "stable", "darwin", "arm64")}
	var published []appupdates.Snapshot
	coordinator := appupdates.New(appupdates.Dependencies{
		Client: client, Provider: fakeProvider{}, Eligibility: enabledBuild(),
		PublicKey: testPublicKey(), Platform: "darwin", Architecture: "arm64",
		TempRoot: "/owned/temp/root", Scheduler: &fakeScheduler{}, UpdateState: &fakeUpdateState{},
		OnChange: func(snapshot appupdates.Snapshot) {
			published = append(published, snapshot)
		},
	})
	coordinator.RuntimeReady()

	_, err := coordinator.Check(context.Background())
	require.NoError(t, err)
	require.Equal(t, []appupdates.Status{
		appupdates.StatusChecking,
		appupdates.StatusAvailable,
	}, publishedStatuses(published))

	published = nil
	client.downloadErr = errors.New("signature rejected")
	_, err = coordinator.Download(context.Background(), "2.0.0")
	require.EqualError(t, err, "signature rejected")
	require.Equal(t, []appupdates.Status{
		appupdates.StatusDownloading,
		appupdates.StatusPrepareError,
	}, publishedStatuses(published))

	published = nil
	client.downloadErr = nil
	_, err = coordinator.Download(context.Background(), "2.0.0")
	require.NoError(t, err)
	require.Equal(t, []appupdates.Status{
		appupdates.StatusDownloading,
		appupdates.StatusReady,
	}, publishedStatuses(published))

	published = nil
	client.restartErr = errors.New("helper did not start")
	_, err = coordinator.Restart(context.Background())
	require.EqualError(t, err, "helper did not start")
	require.Equal(t, []appupdates.Status{appupdates.StatusRestartError}, publishedStatuses(published))
}

// Wails delivers updater events asynchronously, so one can arrive after the
// operation that emitted it returned and its result was projected.
func newLateEventCoordinator(state *fakeUpdateState) (*appupdates.Coordinator, *updater.Release) {
	release := signedRelease("2.0.0", "stable", "darwin", "arm64")
	coordinator := appupdates.New(appupdates.Dependencies{
		Client: &fakeUpdater{release: release}, Provider: fakeProvider{}, Eligibility: enabledBuild(),
		PublicKey: testPublicKey(), Platform: "darwin", Architecture: "arm64",
		TempRoot: "/owned/temp/root", Scheduler: &fakeScheduler{}, UpdateState: state,
	})
	coordinator.RuntimeReady()
	return coordinator, release
}

func TestLateWailsCheckEventsDoNotOverwriteAFinishedCheck(t *testing.T) {
	t.Parallel()
	coordinator, _ := newLateEventCoordinator(&fakeUpdateState{})

	_, err := coordinator.Check(context.Background())
	require.NoError(t, err)
	coordinator.HandleWailsEvent(updater.EventCheckStarted, nil)

	require.Equal(t, appupdates.StatusAvailable, coordinator.Snapshot().Status)
}

func TestLateWailsDownloadEventsDoNotOverwriteAFinishedDownload(t *testing.T) {
	t.Parallel()
	state := &fakeUpdateState{recordErr: errors.New("staging is outside the owned locations")}
	coordinator, release := newLateEventCoordinator(state)
	_, err := coordinator.Check(context.Background())
	require.NoError(t, err)

	_, err = coordinator.Download(context.Background(), "2.0.0")
	require.Error(t, err)
	coordinator.HandleWailsEvent(updater.EventInstalling, release)
	coordinator.HandleWailsEvent(updater.EventUpdateReady, release)
	failed := coordinator.Snapshot()
	require.Equal(t, appupdates.StatusPrepareError, failed.Status, "the user must be offered a retry")
	require.Equal(t, "staging is outside the owned locations", failed.Error)

	state.recordErr = nil
	_, err = coordinator.Download(context.Background(), "2.0.0")
	require.NoError(t, err)
	coordinator.HandleWailsEvent(updater.EventDownloadProgress, updater.Progress{Written: 1, Total: 2})
	coordinator.HandleWailsEvent(updater.EventVerifying, release)
	require.Equal(t, appupdates.StatusReady, coordinator.Snapshot().Status)
}

// An event admitted during the download can publish after the download's own
// result; the result's higher revision lets consumers discard the stale one.
func TestAnEventPublishedAfterTheDownloadResultIsSupersededByRevision(t *testing.T) {
	t.Parallel()
	client := &fakeUpdater{release: signedRelease("2.0.0", "stable", "darwin", "arm64")}
	var mu sync.Mutex
	var published []appupdates.Snapshot
	projected, resume := make(chan struct{}), make(chan struct{})
	var holdOnce sync.Once
	coordinator := newCheckedCoordinator(t, client, func(snapshot appupdates.Snapshot) {
		if snapshot.Status == appupdates.StatusPreparing {
			holdOnce.Do(func() { close(projected) })
			<-resume
		}
		mu.Lock()
		published = append(published, snapshot)
		mu.Unlock()
	})

	eventDone := make(chan struct{})
	duringDownload(t, coordinator, client, func() {
		go func() {
			defer close(eventDone)
			coordinator.HandleWailsEvent(updater.EventUpdateReady, nil)
		}()
		<-projected
	})
	close(resume)
	<-eventDone

	require.Equal(t, appupdates.StatusPreparing, published[len(published)-1].Status,
		"the stale event must publish last for this test to exercise reordering")
	var current *appupdates.Snapshot
	for index := range published {
		if current == nil || published[index].Revision >= current.Revision {
			current = &published[index]
		}
	}
	require.Equal(t, appupdates.StatusReady, current.Status)
	require.Equal(t, coordinator.Snapshot(), *current)
}

func publishedStatuses(snapshots []appupdates.Snapshot) []appupdates.Status {
	statuses := make([]appupdates.Status, 0, len(snapshots))
	for _, snapshot := range snapshots {
		statuses = append(statuses, snapshot.Status)
	}
	return statuses
}

func TestUnrecognizedOrMalformedWailsEventsDoNotPublishUnchangedState(t *testing.T) {
	t.Parallel()

	client := &fakeUpdater{release: signedRelease("2.0.0", "stable", "darwin", "arm64")}
	var published []appupdates.Snapshot
	coordinator := newCheckedCoordinator(t, client, func(snapshot appupdates.Snapshot) {
		published = append(published, snapshot)
	})

	duringDownload(t, coordinator, client, func() {
		published = nil
		coordinator.HandleWailsEvent("unknown", nil)
		coordinator.HandleWailsEvent(updater.EventDownloadProgress, "not-progress")
		coordinator.HandleWailsEvent(updater.EventError, "not-error-info")
		require.Empty(t, published)
	})
}

func TestProgressPublicationComparesValuesAndOwnsItsSnapshot(t *testing.T) {
	t.Parallel()

	client := &fakeUpdater{release: signedRelease("2.0.0", "stable", "darwin", "arm64")}
	var published []appupdates.Snapshot
	coordinator := newCheckedCoordinator(t, client, func(snapshot appupdates.Snapshot) {
		published = append(published, snapshot)
	})

	duringDownload(t, coordinator, client, func() {
		published = nil
		coordinator.HandleWailsEvent(updater.EventDownloadProgress, updater.Progress{Written: 25, Total: 100})
		coordinator.HandleWailsEvent(updater.EventDownloadProgress, updater.Progress{Written: 50, Total: 200})
		require.Len(t, published, 1, "equivalent progress must not publish a second update")
		*published[0].ProgressPercent = 90
		require.Equal(t, float64(25), *coordinator.Snapshot().ProgressPercent)

		coordinator.HandleWailsEvent(updater.EventDownloadProgress, updater.Progress{Written: 50, Total: 100})
		require.Len(t, published, 2)
		require.Equal(t, float64(50), *published[1].ProgressPercent)
		coordinator.HandleWailsEvent(updater.EventDownloadProgress, updater.Progress{Total: 0})
		coordinator.HandleWailsEvent(updater.EventDownloadProgress, updater.Progress{Total: 0})
		require.Len(t, published, 3, "unknown progress is a distinct state but repeats are ignored")
		require.Nil(t, published[2].ProgressPercent)
	})
}

func TestHandleWailsEventProjectsSemanticStateAndBoundedProgress(t *testing.T) {
	t.Parallel()

	client := &fakeUpdater{release: signedRelease("2.0.0", "stable", "darwin", "arm64")}
	coordinator := newCheckedCoordinator(t, client, nil)

	duringDownload(t, coordinator, client, func() {
		snapshot := coordinator.HandleWailsEvent(updater.EventDownloadStarted, nil)
		require.Equal(t, appupdates.StatusDownloading, snapshot.Status)
		require.Nil(t, snapshot.ProgressPercent)

		snapshot = coordinator.HandleWailsEvent(updater.EventDownloadProgress, updater.Progress{Written: 25, Total: 100})
		require.Equal(t, appupdates.StatusDownloading, snapshot.Status)
		require.NotNil(t, snapshot.ProgressPercent)
		require.Equal(t, float64(25), *snapshot.ProgressPercent)

		snapshot = coordinator.HandleWailsEvent(updater.EventDownloadProgress, updater.Progress{Written: 5, Total: 0})
		require.Nil(t, snapshot.ProgressPercent)
		snapshot = coordinator.HandleWailsEvent(updater.EventDownloadProgress, updater.Progress{Written: 101, Total: 100})
		require.Nil(t, snapshot.ProgressPercent)

		snapshot = coordinator.HandleWailsEvent(updater.EventVerifying, nil)
		require.Equal(t, appupdates.StatusVerifying, snapshot.Status)
		require.Nil(t, snapshot.ProgressPercent)
		snapshot = coordinator.HandleWailsEvent(updater.EventInstalling, nil)
		require.Equal(t, appupdates.StatusPreparing, snapshot.Status)
		snapshot = coordinator.HandleWailsEvent(updater.EventUpdateReady, nil)
		require.Equal(t, appupdates.StatusPreparing, snapshot.Status, "ready only once the download records it")
	})

	require.Equal(t, appupdates.StatusReady, coordinator.Snapshot().Status)
}

func TestHandleWailsEventClassifiesFailureStage(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		stage updater.Stage
		want  appupdates.Status
	}{
		{stage: updater.StageCheck, want: appupdates.StatusCheckError},
		{stage: updater.StageDownload, want: appupdates.StatusPrepareError},
		{stage: updater.StageVerify, want: appupdates.StatusPrepareError},
		{stage: updater.StageInstall, want: appupdates.StatusPrepareError},
	} {
		client := &fakeUpdater{release: signedRelease("2.0.0", "stable", "darwin", "arm64")}
		failure := updater.ErrorInfo{Stage: test.stage, Message: "operation failed"}
		var snapshot appupdates.Snapshot

		if test.stage == updater.StageCheck {
			coordinator := newTestCoordinator(client, enabledBuild(), "darwin", "arm64")
			coordinator.RuntimeReady()
			duringCheck(t, client, func() { _, _ = coordinator.Check(context.Background()) }, func() {
				snapshot = coordinator.HandleWailsEvent(updater.EventError, failure)
			})
		} else {
			coordinator := newCheckedCoordinator(t, client, nil)
			duringDownload(t, coordinator, client, func() {
				snapshot = coordinator.HandleWailsEvent(updater.EventError, failure)
			})
		}

		require.Equal(t, test.want, snapshot.Status, test.stage)
		require.Equal(t, "operation failed", snapshot.Error)
	}
}
