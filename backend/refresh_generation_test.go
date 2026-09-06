package backend

import (
	"context"
	"errors"
	"testing"

	"github.com/luxury-yacht/app/backend/internal/authstate"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/stretchr/testify/require"
)

type failingPermissionRebuildRuntime struct {
	refreshClusterRuntime
	attempts int
	err      error
	clients  *clusterClients
}

func (r *failingPermissionRebuildRuntime) buildClusterClientsWithManager(context.Context, kubeconfigSelection, ClusterMeta, *authstate.Manager) (*clusterClients, error) {
	r.attempts++
	return r.clients, r.err
}

func TestPermissionReplacementReportsRepeatedBuildFailureOnce(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	reporter := &recordingErrorReporter{}
	app.Refresh.logger = NewLogger(100, reporter)
	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
		"cluster-a": {meta: ClusterMeta{ID: "cluster-a"}, kubeconfigPath: "/missing/config"},
	}
	runtime := &failingPermissionRebuildRuntime{refreshClusterRuntime: app.ClusterRuntime, err: errors.New("client construction failed")}
	app.Refresh.clusterRuntime = runtime
	previous := &system.Subsystem{}
	app.Refresh.setRefreshSubsystem("cluster-a", previous)
	failures := &clusterRebuildFailures{}
	for range 3 {
		app.Refresh.rebuildForPermissionChange(context.Background(), "cluster-a", previous, failures)
	}
	require.Equal(t, 3, runtime.attempts, "report suppression must not suppress recovery attempts")
	require.Len(t, app.Refresh.logger.GetEntries(), 1)
	runtime.err = errors.New("different construction failure")
	app.Refresh.rebuildForPermissionChange(context.Background(), "cluster-a", previous, failures)
	require.Len(t, app.Refresh.logger.GetEntries(), 2, "changed failures must remain visible")

	app.ClusterRuntime.clusterClients["cluster-b"] = &clusterClients{meta: ClusterMeta{ID: "cluster-b"}, kubeconfigPath: "/missing/config"}
	other := &system.Subsystem{}
	app.Refresh.setRefreshSubsystem("cluster-b", other)
	app.Refresh.rebuildForPermissionChange(context.Background(), "cluster-b", other, &clusterRebuildFailures{})
	require.Len(t, app.Refresh.logger.GetEntries(), 3, "another cluster owns independent failure reporting")

	next := &system.Subsystem{}
	app.Refresh.setRefreshSubsystem("cluster-a", next)
	app.Refresh.rebuildForPermissionChange(context.Background(), "cluster-a", next, &clusterRebuildFailures{})
	require.Len(t, app.Refresh.logger.GetEntries(), 4, "a replacement generation must report its own failures")
	reporter.mu.Lock()
	defer reporter.mu.Unlock()
	require.Len(t, reporter.exceptions, 4)
}

func TestRebuildFailureReportingResetsOnlyTheRecoveredStage(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	app.Refresh.logger = NewLogger(100)
	app.Refresh.clusterRuntime = &failingPermissionRebuildRuntime{
		refreshClusterRuntime: app.ClusterRuntime,
		clients:               &clusterClients{},
	}
	r := clusterSubsystemRebuild{
		refresh: app.Refresh, clusterID: "cluster-a", oldClients: &clusterClients{},
		failures: &clusterRebuildFailures{},
	}
	err := errors.New("construction failed")
	r.reportBuildError("clients", "client rebuild failed", err)
	r.reportBuildError("subsystem", "subsystem rebuild failed", err)
	_, ok := r.rebuildClients(context.Background())
	require.True(t, ok)
	r.reportBuildError("clients", "client rebuild failed", err)
	r.reportBuildError("subsystem", "subsystem rebuild failed", err)
	require.Len(t, app.Refresh.logger.GetEntries(), 3,
		"client recovery must rearm its report while leaving the unrecovered subsystem failure suppressed")
}

type cancelTrackingSnapshotService struct {
	canceled bool
}

func (*cancelTrackingSnapshotService) Build(context.Context, string, string) (*refresh.Snapshot, error) {
	return &refresh.Snapshot{}, nil
}

func (s *cancelTrackingSnapshotService) CancelInFlight() {
	s.canceled = true
}

func permissionRevalidationOwner(
	coordinator *RefreshCoordinator,
	clusterID string,
) *system.Subsystem {
	coordinator.refreshGenerationMu.Lock()
	defer coordinator.refreshGenerationMu.Unlock()
	for subsystem, runtime := range coordinator.refreshGenerationRuntimes {
		if runtime.clusterID == clusterID && runtime.permissionCancel != nil {
			return subsystem
		}
	}
	return nil
}

func hasRefreshManagerContext(
	coordinator *RefreshCoordinator,
	subsystem *system.Subsystem,
) bool {
	coordinator.refreshGenerationMu.Lock()
	defer coordinator.refreshGenerationMu.Unlock()
	_, ok := coordinator.refreshGenerationRuntimes[subsystem]
	return ok
}

func TestRefreshGenerationRollbackPreservesPreviousPermissionRevalidation(t *testing.T) {
	const clusterID = "cluster-a"
	app := newWorkspaceCoordinatorTestFixture(t)
	previous := &system.Subsystem{}
	previousCanceled := false
	previousManagerCanceled := false
	app.Refresh.commitRefreshGenerationRuntime(
		clusterID,
		previous,
		func() { previousManagerCanceled = true },
		func() { previousCanceled = true },
	)

	next := &system.Subsystem{Manager: refresh.NewManager(nil, nil, nil, nil, nil)}
	activation, err := app.Refresh.startRefreshGeneration(context.Background(), clusterID, next)
	require.NoError(t, err)
	require.False(t, previousCanceled,
		"starting an unpublished generation must not displace the routed generation")

	activation.rollback()
	require.False(t, previousCanceled,
		"rolling back an unpublished generation must not cancel the routed generation")
	require.False(t, previousManagerCanceled)
	require.Same(t, previous, permissionRevalidationOwner(app.Refresh, clusterID))

	app.Refresh.stopRefreshGeneration(clusterID, previous)
	require.True(t, previousCanceled)
	require.True(t, previousManagerCanceled)
}

func TestRefreshGenerationStopCannotCancelRoutedReplacement(t *testing.T) {
	const clusterID = "cluster-a"
	app := newWorkspaceCoordinatorTestFixture(t)
	previous := &system.Subsystem{}
	previousCanceled := false
	previousManagerCanceled := false
	app.Refresh.commitRefreshGenerationRuntime(
		clusterID,
		previous,
		func() { previousManagerCanceled = true },
		func() { previousCanceled = true },
	)

	next := &system.Subsystem{Manager: refresh.NewManager(nil, nil, nil, nil, nil)}
	activation, err := app.Refresh.startRefreshGeneration(context.Background(), clusterID, next)
	require.NoError(t, err)
	activation.commit()
	require.True(t, previousCanceled,
		"committing a routed replacement must retire the previous revalidator")
	require.False(t, previousManagerCanceled,
		"the previous manager must remain alive until reverse-order teardown reaches it")
	require.Same(t, next, permissionRevalidationOwner(app.Refresh, clusterID))
	require.True(t, hasRefreshManagerContext(app.Refresh, next))

	app.Refresh.stopRefreshGeneration(clusterID, previous)
	require.True(t, previousManagerCanceled)
	require.Same(t, next, permissionRevalidationOwner(app.Refresh, clusterID),
		"stopping the old generation must not cancel its routed replacement")
	require.True(t, hasRefreshManagerContext(app.Refresh, next))

	app.Refresh.stopRefreshGeneration(clusterID, next)
	require.Nil(t, permissionRevalidationOwner(app.Refresh, clusterID))
	require.False(t, hasRefreshManagerContext(app.Refresh, next))
}

func TestRefreshGenerationStopCancelsOnlyCurrentSnapshotFlights(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	service := &cancelTrackingSnapshotService{}
	subsystem := &system.Subsystem{SnapshotService: service}

	app.Refresh.stopRefreshGeneration("cluster-a", subsystem)

	require.True(t, service.canceled)
}

func TestRefreshGenerationBatchCommitAndRollback(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	subsystems := map[string]*system.Subsystem{
		"cluster-a": {Manager: refresh.NewManager(nil, nil, nil, nil, nil)},
		"cluster-b": {Manager: refresh.NewManager(nil, nil, nil, nil, nil)},
	}

	activations, err := app.Refresh.startRefreshGenerations(context.Background(), subsystems)
	require.NoError(t, err)
	commitRefreshGenerations(activations)
	require.Same(t, subsystems["cluster-a"], permissionRevalidationOwner(app.Refresh, "cluster-a"))
	require.Same(t, subsystems["cluster-b"], permissionRevalidationOwner(app.Refresh, "cluster-b"))
	for clusterID, subsystem := range subsystems {
		app.Refresh.stopRefreshGeneration(clusterID, subsystem)
	}

	rollbackSubsystems := map[string]*system.Subsystem{
		"cluster-c": {Manager: refresh.NewManager(nil, nil, nil, nil, nil)},
		"cluster-d": {Manager: refresh.NewManager(nil, nil, nil, nil, nil)},
	}
	activations, err = app.Refresh.startRefreshGenerations(context.Background(), rollbackSubsystems)
	require.NoError(t, err)
	rollbackRefreshGenerations(activations)
	require.Nil(t, permissionRevalidationOwner(app.Refresh, "cluster-c"))
	require.Nil(t, permissionRevalidationOwner(app.Refresh, "cluster-d"))
}

func TestRefreshGenerationBatchStartFailureStopsEveryCandidate(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	started := &system.Subsystem{Manager: refresh.NewManager(nil, nil, nil, nil, nil)}
	startedPreparation, ok := started.BeginColdPreparation(context.Background(), app.Refresh.governorTime())
	require.True(t, ok)
	invalid := &system.Subsystem{}
	invalidPreparation, ok := invalid.BeginColdPreparation(context.Background(), app.Refresh.governorTime())
	require.True(t, ok)

	_, err := app.Refresh.startRefreshGenerations(context.Background(), map[string]*system.Subsystem{
		"cluster-a": started,
		"cluster-b": invalid,
	})
	require.Error(t, err)
	require.ErrorIs(t, startedPreparation.Err(), context.Canceled)
	require.ErrorIs(t, invalidPreparation.Err(), context.Canceled)
}

func TestRefreshGenerationRuntimeReplacementIsGenerationScoped(t *testing.T) {
	const clusterID = "cluster-a"
	app := newWorkspaceCoordinatorTestFixture(t)
	app.Refresh.refreshGenerationRuntimes = nil
	subsystem := &system.Subsystem{}
	oldManagerCanceled := false
	oldPermissionCanceled := false
	app.Refresh.commitRefreshGenerationRuntime(
		clusterID,
		subsystem,
		func() { oldManagerCanceled = true },
		func() { oldPermissionCanceled = true },
	)

	newManagerCanceled := false
	newPermissionCanceled := false
	app.Refresh.commitRefreshGenerationRuntime(
		clusterID,
		subsystem,
		func() { newManagerCanceled = true },
		func() { newPermissionCanceled = true },
	)
	require.True(t, oldManagerCanceled)
	require.True(t, oldPermissionCanceled)
	require.False(t, newManagerCanceled)
	require.False(t, newPermissionCanceled)
	require.Same(t, subsystem, permissionRevalidationOwner(app.Refresh, clusterID))

	app.Refresh.stopRefreshGeneration(clusterID, subsystem)
	require.True(t, newManagerCanceled)
	require.True(t, newPermissionCanceled)
}

func TestRefreshGenerationOrphansUseNormalStopContract(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	subsystemA := &system.Subsystem{}
	subsystemB := &system.Subsystem{}
	managerCanceledA := false
	permissionCanceledA := false
	managerCanceledB := false
	permissionCanceledB := false
	app.Refresh.commitRefreshGenerationRuntime(
		"cluster-a",
		subsystemA,
		func() { managerCanceledA = true },
		func() { permissionCanceledA = true },
	)
	app.Refresh.commitRefreshGenerationRuntime(
		"cluster-b",
		subsystemB,
		func() { managerCanceledB = true },
		func() { permissionCanceledB = true },
	)

	app.Refresh.stopRefreshGenerationRuntimesForCluster("cluster-a")
	require.True(t, managerCanceledA)
	require.True(t, permissionCanceledA)
	require.False(t, managerCanceledB)
	require.False(t, permissionCanceledB)
	require.Same(t, subsystemB, permissionRevalidationOwner(app.Refresh, "cluster-b"))

	app.Refresh.stopRemainingRefreshGenerationRuntimes()
	require.True(t, managerCanceledB)
	require.True(t, permissionCanceledB)
}

func TestPermissionReplacementFailurePreservesServingGeneration(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	service := &cancelTrackingSnapshotService{}
	previous := &system.Subsystem{SnapshotService: service}
	app.Refresh.setRefreshSubsystem("cluster-a", previous)
	emitted := false
	app.Refresh.emitEventFn = func(string, ...interface{}) { emitted = true }
	failures := &clusterRebuildFailures{}
	for range 2 {
		app.Refresh.rebuildForPermissionChange(context.Background(), "cluster-a", previous, failures)
	}
	require.Same(t, previous, app.Refresh.getRefreshSubsystem("cluster-a"))
	require.False(t, service.canceled)
	require.False(t, emitted, "failed replacement must not announce a new permission epoch")
	next := &system.Subsystem{}
	app.Refresh.setRefreshSubsystem("cluster-a", next)
	app.Refresh.rebuildForPermissionChange(context.Background(), "cluster-a", previous, failures)
	require.Same(t, next, app.Refresh.getRefreshSubsystem("cluster-a"))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	app.Refresh.rebuildForPermissionChange(ctx, "cluster-a", next, &clusterRebuildFailures{})
	require.Same(t, next, app.Refresh.getRefreshSubsystem("cluster-a"))
}
