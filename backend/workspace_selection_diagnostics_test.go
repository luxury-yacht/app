package backend

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestGetSelectionDiagnosticsEmpty(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)

	diag, err := app.Workspace.GetSelectionDiagnostics()
	require.NoError(t, err)
	require.NotNil(t, diag)
	require.Zero(t, diag.TotalMutations)
	require.Zero(t, diag.SampleCount)
}

func TestSelectionDiagnosticsRecordsPhasePercentiles(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)

	require.NoError(t, app.Workspace.runSelectionMutation("test-1", func(m *selectionMutation) error {
		m.phases.intent = 10 * time.Millisecond
		m.phases.commit = 4 * time.Millisecond
		m.phases.clientSync = 30 * time.Millisecond
		m.phases.refresh = 20 * time.Millisecond
		m.phases.objectCatalog = 5 * time.Millisecond
		time.Sleep(3 * time.Millisecond)
		return nil
	}))

	require.NoError(t, app.Workspace.runSelectionMutation("test-2", func(m *selectionMutation) error {
		m.phases.intent = 20 * time.Millisecond
		m.phases.commit = 8 * time.Millisecond
		m.phases.clientSync = 40 * time.Millisecond
		m.phases.refresh = 40 * time.Millisecond
		m.phases.objectCatalog = 10 * time.Millisecond
		time.Sleep(4 * time.Millisecond)
		return nil
	}))

	diag, err := app.Workspace.GetSelectionDiagnostics()
	require.NoError(t, err)
	require.Equal(t, uint64(2), diag.TotalMutations)
	require.Equal(t, uint64(2), diag.CompletedMutations)
	require.Equal(t, 2, diag.SampleCount)
	require.Greater(t, diag.IntentP50Ms, int64(0))
	require.GreaterOrEqual(t, diag.IntentP95Ms, diag.IntentP50Ms)
	require.Greater(t, diag.ClientSyncP50Ms, int64(0))
	require.GreaterOrEqual(t, diag.ClientSyncP95Ms, diag.ClientSyncP50Ms)
	require.Greater(t, diag.TotalP50Ms, int64(0))
}

func TestSelectionDiagnosticsTracksCanceledAndSuperseded(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)

	// Scenario A: force a superseded queued generation.
	releaseFirst := make(chan struct{})
	firstStarted := make(chan struct{})

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		_ = app.Workspace.runSelectionMutation("first", func(m *selectionMutation) error {
			close(firstStarted)
			<-releaseFirst
			return nil
		})
	}()

	<-firstStarted

	secondDone := make(chan struct{})
	wg.Add(1)
	go func() {
		defer wg.Done()
		_ = app.Workspace.runSelectionMutation("second", func(*selectionMutation) error {
			return nil
		})
		close(secondDone)
	}()

	// Let second enqueue behind first, then supersede it with third.
	time.Sleep(25 * time.Millisecond)
	go func() {
		time.Sleep(20 * time.Millisecond)
		close(releaseFirst)
	}()
	require.NoError(t, app.Workspace.runSelectionMutation("third", func(*selectionMutation) error {
		return nil
	}))

	<-secondDone
	wg.Wait()

	// Scenario B: force a canceled in-flight generation.
	cancelStarted := make(chan struct{})
	wg.Add(1)
	go func() {
		defer wg.Done()
		_ = app.Workspace.runSelectionMutation("cancel-me", func(m *selectionMutation) error {
			close(cancelStarted)
			<-m.context().Done()
			return m.context().Err()
		})
	}()
	<-cancelStarted
	require.NoError(t, app.Workspace.runSelectionMutation("cancel-trigger", func(*selectionMutation) error {
		return nil
	}))
	wg.Wait()

	diag, err := app.Workspace.GetSelectionDiagnostics()
	require.NoError(t, err)
	require.GreaterOrEqual(t, diag.CanceledMutations, uint64(1))
	require.GreaterOrEqual(t, diag.SupersededMutations, uint64(1))
}

func TestSelectionDiagnosticsTreatsDeadlineAsFailure(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)

	err := app.Workspace.runSelectionMutation("deadline", func(*selectionMutation) error {
		return context.DeadlineExceeded
	})
	require.Error(t, err)

	diag, diagErr := app.Workspace.GetSelectionDiagnostics()
	require.NoError(t, diagErr)
	require.Equal(t, uint64(1), diag.TotalMutations)
	require.Equal(t, uint64(1), diag.FailedMutations)
	require.Zero(t, diag.CanceledMutations)
}
