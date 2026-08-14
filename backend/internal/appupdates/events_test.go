package appupdates_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/appupdates"
	"github.com/luxury-yacht/app/internal/updateidentity"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/updater"
)

func TestWailsEventsPublishCompleteApplicationSnapshot(t *testing.T) {
	t.Parallel()

	var published []appupdates.Snapshot
	coordinator := appupdates.New(appupdates.Dependencies{
		Client: &fakeUpdater{}, Provider: fakeProvider{}, Eligibility: enabledBuild(),
		PublicKey: testPublicKey(), Platform: "darwin", Architecture: "arm64",
		TempRoot: "/owned/temp/root", Scheduler: &fakeScheduler{},
		OnChange: func(snapshot appupdates.Snapshot) {
			published = append(published, snapshot)
		},
	})
	publishedAt := time.Date(2026, time.August, 14, 12, 30, 0, 0, time.UTC)
	release := signedRelease("2.0.0", "beta", "darwin", "arm64")
	release.Name = "Luxury Yacht 2.0.0"
	release.Notes = "## Safer updates"
	release.PublishedAt = publishedAt

	snapshot := coordinator.HandleWailsEvent(updater.EventUpdateAvailable, release)

	require.Equal(t, appupdates.Snapshot{
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
	require.Equal(t, []appupdates.Snapshot{snapshot}, published)
	require.Equal(t, snapshot, coordinator.Snapshot())

	coordinator.HandleWailsEvent(updater.EventVerifying, release)
	require.Len(t, published, 2)
}

func TestCoordinatorOperationsPublishCommandOwnedTransitions(t *testing.T) {
	t.Parallel()

	client := &fakeUpdater{release: signedRelease("2.0.0", "beta", "darwin", "arm64")}
	var published []appupdates.Snapshot
	coordinator := appupdates.New(appupdates.Dependencies{
		Client: client, Provider: fakeProvider{}, Eligibility: enabledBuild(),
		PublicKey: testPublicKey(), Platform: "darwin", Architecture: "arm64",
		TempRoot: "/owned/temp/root", Scheduler: &fakeScheduler{},
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

func publishedStatuses(snapshots []appupdates.Snapshot) []appupdates.Status {
	statuses := make([]appupdates.Status, 0, len(snapshots))
	for _, snapshot := range snapshots {
		statuses = append(statuses, snapshot.Status)
	}
	return statuses
}

func TestUnrecognizedOrMalformedWailsEventsDoNotPublishUnchangedState(t *testing.T) {
	t.Parallel()

	var published []appupdates.Snapshot
	coordinator := appupdates.New(appupdates.Dependencies{
		Client: &fakeUpdater{}, Provider: fakeProvider{}, Eligibility: enabledBuild(),
		PublicKey: testPublicKey(), Platform: "darwin", Architecture: "arm64",
		TempRoot: "/owned/temp/root", Scheduler: &fakeScheduler{},
		OnChange: func(snapshot appupdates.Snapshot) {
			published = append(published, snapshot)
		},
	})

	coordinator.HandleWailsEvent("unknown", nil)
	coordinator.HandleWailsEvent(updater.EventUpdateAvailable, "not-a-release")
	coordinator.HandleWailsEvent(updater.EventError, "not-error-info")

	require.Empty(t, published)
}

func TestHandleWailsEventProjectsSemanticStateAndBoundedProgress(t *testing.T) {
	t.Parallel()

	coordinator := newTestCoordinator(&fakeUpdater{}, enabledBuild(), "darwin", "arm64")

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
	require.Equal(t, appupdates.StatusReady, snapshot.Status)
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
		coordinator := newTestCoordinator(&fakeUpdater{}, enabledBuild(), "darwin", "arm64")

		snapshot := coordinator.HandleWailsEvent(updater.EventError, updater.ErrorInfo{
			Stage: test.stage, Message: "operation failed",
		})

		require.Equal(t, test.want, snapshot.Status)
		require.Equal(t, "operation failed", snapshot.Error)
	}
}
