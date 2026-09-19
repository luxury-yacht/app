package appupdates_test

import (
	"context"
	"sync/atomic"
	"testing"

	"github.com/luxury-yacht/app/backend/internal/appupdates"
	"github.com/stretchr/testify/require"
)

// Track the cancellation registrations retained by completed operations without
// relying on process-wide goroutine counts or scheduling delays.
type trackedOperationParent struct {
	context.Context
	done   chan struct{}
	active atomic.Int32
}

func (parent *trackedOperationParent) Done() <-chan struct{} { return parent.done }

func (parent *trackedOperationParent) AfterFunc(func()) func() bool {
	parent.active.Add(1)
	var stopped atomic.Bool
	return func() bool {
		if !stopped.CompareAndSwap(false, true) {
			return false
		}
		parent.active.Add(-1)
		return true
	}
}

func TestCompletedUpdateOperationsReleaseParentCancellation(t *testing.T) {
	client := &fakeUpdater{release: signedRelease("2.0.0", "stable", "darwin", "arm64")}
	coordinator := appupdates.New(appupdates.Dependencies{
		Client: client, Provider: fakeProvider{}, Eligibility: enabledBuild(),
		PublicKey: testPublicKey(), Platform: "darwin", Architecture: "arm64",
		TempRoot: "/owned/temp/root", Scheduler: &fakeScheduler{}, UpdateState: &fakeUpdateState{},
	})
	t.Cleanup(coordinator.Stop)
	coordinator.RuntimeReady()
	parent := &trackedOperationParent{Context: context.Background(), done: make(chan struct{})}

	_, err := coordinator.Check(parent)
	require.NoError(t, err)
	require.Zero(t, parent.active.Load(), "completed check retained its parent cancellation registration")
	_, err = coordinator.Download(parent, "2.0.0")
	require.NoError(t, err)
	require.Zero(t, parent.active.Load(), "completed download retained its parent cancellation registration")
	_, err = coordinator.Restart(parent)
	require.NoError(t, err)
	require.Zero(t, parent.active.Load(), "completed restart retained its parent cancellation registration")
}

func TestUpdateCompletionCanStartNextOperationWithoutRetainingPreviousCancellation(t *testing.T) {
	client := &fakeUpdater{release: signedRelease("2.0.0", "stable", "darwin", "arm64")}
	parent := &trackedOperationParent{Context: context.Background(), done: make(chan struct{})}
	var coordinator *appupdates.Coordinator
	var downloadErr error
	coordinator = appupdates.New(appupdates.Dependencies{
		Client: client, Provider: fakeProvider{}, Eligibility: enabledBuild(),
		PublicKey: testPublicKey(), Platform: "darwin", Architecture: "arm64",
		TempRoot: "/owned/temp/root", Scheduler: &fakeScheduler{}, UpdateState: &fakeUpdateState{},
		OnChange: func(snapshot appupdates.Snapshot) {
			if snapshot.Status == appupdates.StatusAvailable {
				_, downloadErr = coordinator.Download(parent, snapshot.AvailableVersion)
			}
		},
	})
	t.Cleanup(coordinator.Stop)
	coordinator.RuntimeReady()
	_, err := coordinator.Check(parent)
	require.NoError(t, err)
	require.NoError(t, downloadErr)
	require.Equal(t, appupdates.StatusReady, coordinator.Snapshot().Status)
	require.Zero(t, parent.active.Load(), "starting a download during check publication retained the check registration")
}
