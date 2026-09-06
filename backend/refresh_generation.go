package backend

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/system"
)

// refreshGenerationRuntime owns the contexts attached to one exact subsystem
// generation. Several generations may overlap briefly during a routed swap;
// the replacement retires only the old revalidator until reverse-order
// teardown reaches the old manager.
type refreshGenerationRuntime struct {
	clusterID        string
	managerCancel    context.CancelFunc
	permissionCancel context.CancelFunc
}

// refreshGenerationActivation owns work started before a subsystem is
// published. Commit transfers permission-revalidation ownership to the
// coordinator; rollback cancels and stops only this uncommitted generation.
type refreshGenerationActivation struct {
	refresh          *RefreshCoordinator
	clusterID        string
	subsystem        *system.Subsystem
	managerCancel    context.CancelFunc
	permissionCancel context.CancelFunc
	committed        bool
	rolledBack       bool
}

func (a *RefreshCoordinator) startRefreshGeneration(
	ctx context.Context,
	clusterID string,
	subsystem *system.Subsystem,
) (*refreshGenerationActivation, error) {
	if a == nil {
		return nil, fmt.Errorf("refresh coordinator is nil")
	}
	if ctx == nil {
		return nil, fmt.Errorf("refresh runtime unavailable for cluster %s", clusterID)
	}
	if clusterID == "" {
		return nil, fmt.Errorf("refresh generation cluster identifier is empty")
	}
	if subsystem == nil || subsystem.Manager == nil {
		return nil, fmt.Errorf("refresh manager unavailable for cluster %s", clusterID)
	}

	clusterName := subsystem.ClusterMeta.ClusterName
	if clusterName == "" {
		clusterName = a.clusterRuntime.clusterNameForID(clusterID)
	}
	managerCtx, managerCancel := context.WithCancel(ctx)
	go a.runRefreshGenerationManager(managerCtx, clusterID, clusterName, subsystem.Manager, subsystem.Registry)

	permissionCtx, permissionCancel := context.WithCancel(ctx)
	failures := &clusterRebuildFailures{}
	subsystem.StartPermissionRevalidation(permissionCtx, func(ctx context.Context) {
		a.rebuildForPermissionChange(ctx, clusterID, subsystem, failures)
	})
	return &refreshGenerationActivation{
		refresh:          a,
		clusterID:        clusterID,
		subsystem:        subsystem,
		managerCancel:    managerCancel,
		permissionCancel: permissionCancel,
	}, nil
}

func (a *RefreshCoordinator) runRefreshGenerationManager(
	ctx context.Context,
	clusterID string,
	clusterName string,
	manager *refresh.Manager,
	registry *domain.Registry,
) {
	if err := manager.Start(ctx); err != nil && !errors.Is(err, context.Canceled) {
		a.logger.Warn(fmt.Sprintf("Refresh manager for cluster %s stopped: %v", clusterID, err), logsources.Refresh, clusterID, clusterName)
		return
	}
	// Start blocks until the factory-backed informer caches settle. Remove rows
	// restored from spill when their objects disappeared while the app was closed.
	if registry != nil {
		registry.ReconcileMaintainedStores()
	}
}

func (activation *refreshGenerationActivation) commit() {
	if activation == nil || activation.refresh == nil || activation.committed || activation.rolledBack {
		return
	}
	activation.refresh.commitRefreshGenerationRuntime(
		activation.clusterID,
		activation.subsystem,
		activation.managerCancel,
		activation.permissionCancel,
	)
	activation.managerCancel = nil
	activation.permissionCancel = nil
	activation.committed = true
}

func (activation *refreshGenerationActivation) rollback() {
	if activation == nil || activation.refresh == nil || activation.committed || activation.rolledBack {
		return
	}
	activation.rolledBack = true
	if activation.managerCancel != nil {
		activation.managerCancel()
		activation.managerCancel = nil
	}
	if activation.permissionCancel != nil {
		activation.permissionCancel()
		activation.permissionCancel = nil
	}
	activation.refresh.stopRefreshGeneration(activation.clusterID, activation.subsystem)
}

func (a *RefreshCoordinator) startRefreshGenerations(
	ctx context.Context,
	subsystems map[string]*system.Subsystem,
) (map[string]*refreshGenerationActivation, error) {
	activations := make(map[string]*refreshGenerationActivation, len(subsystems))
	for clusterID, subsystem := range subsystems {
		activation, err := a.startRefreshGeneration(ctx, clusterID, subsystem)
		if err != nil {
			for _, started := range activations {
				started.rollback()
			}
			for pendingID, pending := range subsystems {
				if _, started := activations[pendingID]; started {
					continue
				}
				a.stopRefreshGeneration(pendingID, pending)
			}
			return nil, err
		}
		activations[clusterID] = activation
	}
	return activations, nil
}

func commitRefreshGenerations(activations map[string]*refreshGenerationActivation) {
	for _, activation := range activations {
		activation.commit()
	}
}

func rollbackRefreshGenerations(activations map[string]*refreshGenerationActivation) {
	for _, activation := range activations {
		activation.rollback()
	}
}

func refreshGenerationRuntimeCancellations(runtime refreshGenerationRuntime) []context.CancelFunc {
	cancellations := make([]context.CancelFunc, 0, 2)
	if runtime.permissionCancel != nil {
		cancellations = append(cancellations, runtime.permissionCancel)
	}
	if runtime.managerCancel != nil {
		cancellations = append(cancellations, runtime.managerCancel)
	}
	return cancellations
}

func (a *RefreshCoordinator) commitRefreshGenerationRuntime(
	clusterID string,
	subsystem *system.Subsystem,
	managerCancel context.CancelFunc,
	permissionCancel context.CancelFunc,
) {
	if a == nil || clusterID == "" || subsystem == nil || managerCancel == nil || permissionCancel == nil {
		return
	}
	a.refreshGenerationMu.Lock()
	if a.refreshGenerationRuntimes == nil {
		a.refreshGenerationRuntimes = make(map[*system.Subsystem]refreshGenerationRuntime)
	}
	var retired []context.CancelFunc
	for candidate, runtime := range a.refreshGenerationRuntimes {
		if candidate == subsystem {
			retired = append(retired, refreshGenerationRuntimeCancellations(runtime)...)
			delete(a.refreshGenerationRuntimes, candidate)
			continue
		}
		if runtime.clusterID == clusterID && runtime.permissionCancel != nil {
			retired = append(retired, runtime.permissionCancel)
			runtime.permissionCancel = nil
			a.refreshGenerationRuntimes[candidate] = runtime
		}
	}
	a.refreshGenerationRuntimes[subsystem] = refreshGenerationRuntime{
		clusterID:        clusterID,
		managerCancel:    managerCancel,
		permissionCancel: permissionCancel,
	}
	a.refreshGenerationMu.Unlock()
	for _, cancel := range retired {
		cancel()
	}
}

func (a *RefreshCoordinator) takeRefreshGenerationRuntime(
	subsystem *system.Subsystem,
) refreshGenerationRuntime {
	if a == nil || subsystem == nil {
		return refreshGenerationRuntime{}
	}
	a.refreshGenerationMu.Lock()
	runtime := a.refreshGenerationRuntimes[subsystem]
	delete(a.refreshGenerationRuntimes, subsystem)
	a.refreshGenerationMu.Unlock()
	return runtime
}

func (a *RefreshCoordinator) stopRefreshGenerationRuntimesForCluster(clusterID string) {
	if a == nil || clusterID == "" {
		return
	}
	a.refreshGenerationMu.Lock()
	var subsystems []*system.Subsystem
	for subsystem, runtime := range a.refreshGenerationRuntimes {
		if runtime.clusterID != clusterID {
			continue
		}
		subsystems = append(subsystems, subsystem)
	}
	a.refreshGenerationMu.Unlock()
	for _, subsystem := range subsystems {
		a.stopRefreshGeneration(clusterID, subsystem)
	}
}

func (a *RefreshCoordinator) stopRemainingRefreshGenerationRuntimes() {
	if a == nil {
		return
	}
	a.refreshGenerationMu.Lock()
	remaining := make(map[*system.Subsystem]string, len(a.refreshGenerationRuntimes))
	for subsystem, runtime := range a.refreshGenerationRuntimes {
		remaining[subsystem] = runtime.clusterID
	}
	a.refreshGenerationMu.Unlock()
	for subsystem, clusterID := range remaining {
		a.stopRefreshGeneration(clusterID, subsystem)
	}
}

// stopRefreshGeneration is the single reverse-order stop contract for a live
// or partially built subsystem generation. It is generation-aware so stopping
// a replaced subsystem cannot cancel its routed replacement's revalidator.
func (a *RefreshCoordinator) stopRefreshGeneration(clusterID string, subsystem *system.Subsystem) {
	if a == nil || subsystem == nil {
		return
	}
	a.stopRefreshGenerationProducers(clusterID, subsystem)
	subsystem.RetireSnapshotServing()
	a.closeCooledClosers(clusterID, subsystem)
}

// stopRefreshGenerationProducers is also used by cooling, which keeps reads live.
func (a *RefreshCoordinator) stopRefreshGenerationProducers(clusterID string, subsystem *system.Subsystem) {
	if a == nil || subsystem == nil {
		return
	}
	// Catalog sync and its bridges retain this generation's informer and ingest
	// producers. Join them first, without touching a replacement's catalog.
	a.stopObjectCatalogEntry(a.removeObjectCatalogEntry(clusterID, subsystem))
	runtime := a.takeRefreshGenerationRuntime(subsystem)
	subsystem.CancelColdPreparation()
	subsystem.CancelInFlightSnapshots()
	if runtime.permissionCancel != nil {
		runtime.permissionCancel()
	}
	subsystem.StopDoorbellNotifiers()
	if subsystem.ContainerLogs != nil {
		subsystem.ContainerLogs.Stop()
	}
	if subsystem.ResourceStream != nil {
		subsystem.ResourceStream.Stop()
	}
	if runtime.managerCancel != nil {
		runtime.managerCancel()
	}
	if subsystem.Manager != nil {
		a.shutdownRefreshGenerationManager(clusterID, subsystem)
		return
	}
	// A partially built generation may own an informer factory before manager
	// construction completes. Clear it even when no manager can own shutdown.
	if subsystem.InformerFactory != nil {
		_ = subsystem.InformerFactory.Shutdown()
	}
}

func (a *RefreshCoordinator) shutdownRefreshGenerationManager(
	clusterID string,
	subsystem *system.Subsystem,
) {
	done := make(chan error, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), config.RefreshShutdownTimeout)
		defer cancel()
		done <- subsystem.Manager.Shutdown(ctx)
	}()

	timer := time.NewTimer(config.RefreshShutdownTimeout)
	defer timer.Stop()
	select {
	case err := <-done:
		if err != nil {
			a.logger.Warn(fmt.Sprintf("Failed to shutdown refresh manager for cluster %s: %v", clusterID, err), logsources.Refresh, clusterID, subsystem.ClusterMeta.ClusterName)
		}
	case <-timer.C:
		a.logger.Warn(fmt.Sprintf("Timed out waiting for refresh manager shutdown for cluster %s", clusterID), logsources.Refresh, clusterID, subsystem.ClusterMeta.ClusterName)
	}
}

// A revalidator belongs to one generation. Failed builds leave that generation
// serving and revalidating; stale callbacks cannot replace a newer generation.
func (a *RefreshCoordinator) rebuildForPermissionChange(ctx context.Context, clusterID string, expected *system.Subsystem, failures *clusterRebuildFailures) {
	if a == nil || clusterID == "" || expected == nil || ctx.Err() != nil {
		return
	}
	err := a.clusterRuntime.runBackgroundClusterOperation(ctx, clusterID, func(opCtx context.Context) error {
		a.replacePermissionGeneration(opCtx, clusterID, expected, failures)
		return nil
	})
	if err != nil {
		a.logger.Warn(fmt.Sprintf("Permission refresh replacement for cluster %s failed: %v", clusterID, err), logsources.Refresh, clusterID, expected.ClusterMeta.ClusterName)
	}
}

func (a *RefreshCoordinator) replacePermissionGeneration(ctx context.Context, clusterID string, expected *system.Subsystem, failures *clusterRebuildFailures) {
	if ctx.Err() != nil || a.getRefreshSubsystem(clusterID) != expected {
		return
	}
	rebuild, ok := a.prepareClusterSubsystemRebuild(clusterID)
	if !ok {
		return
	}
	rebuild.failures = failures
	clients, ok := rebuild.rebuildClients(ctx)
	if !ok || ctx.Err() != nil || a.getRefreshSubsystem(clusterID) != expected {
		return
	}
	next, ok := rebuild.buildSubsystem(clients)
	if !ok {
		return
	}
	if ctx.Err() != nil || a.getRefreshSubsystem(clusterID) != expected {
		a.stopRefreshGeneration(clusterID, next)
		return
	}
	if rebuild.activateSubsystem(clients, next) && a.emitEventFn != nil {
		a.emitEventFn(clusterPermissionsChangedEventName, ClusterPermissionsChangedEvent{ClusterID: clusterID})
	}
}
