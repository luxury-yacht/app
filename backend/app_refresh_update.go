package backend

import (
	"context"
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/refresh/system"
)

// updateRefreshSubsystemSelections updates active refresh subsystems without restarting the HTTP server.
func (a *App) updateRefreshSubsystemSelections(selections []kubeconfigSelection) error {
	if err := a.validateRefreshSelectionUpdate(); err != nil {
		return err
	}
	if len(selections) == 0 {
		return nil
	}
	if a.refreshSelectionUpdateNeedsSetup() {
		return a.setupRefreshSubsystem()
	}
	plan, err := a.planRefreshSelectionUpdate(selections)
	if err != nil {
		return err
	}
	update, err := a.buildRefreshSelectionUpdate(plan, selections)
	if err != nil {
		return err
	}
	return a.applyRefreshSelectionUpdate(plan, update)
}

func (a *App) validateRefreshSelectionUpdate() error {
	if a == nil {
		return fmt.Errorf("app is nil")
	}
	return nil
}

func (a *App) refreshSelectionUpdateNeedsSetup() bool {
	return a.refreshService.Load() == nil || a.refreshAggregates.Load() == nil || a.currentRefreshRuntimeContext() == nil
}

type refreshSelectionPlan struct {
	clusterOrder []string
	desired      map[string]kubeconfigSelection
	metaByID     map[string]ClusterMeta
}

func (a *App) planRefreshSelectionUpdate(selections []kubeconfigSelection) (refreshSelectionPlan, error) {
	plan := refreshSelectionPlan{
		clusterOrder: make([]string, 0, len(selections)),
		desired:      make(map[string]kubeconfigSelection, len(selections)),
		metaByID:     make(map[string]ClusterMeta, len(selections)),
	}
	for _, selection := range selections {
		meta := a.clusterMetaForSelection(selection)
		if meta.ID == "" {
			return refreshSelectionPlan{}, fmt.Errorf("cluster identifier missing for selection %s", selection.String())
		}
		meta = a.canonicalClusterMeta(selection, meta)
		if _, exists := plan.desired[meta.ID]; exists {
			continue
		}
		plan.desired[meta.ID] = selection
		plan.metaByID[meta.ID] = meta
		plan.clusterOrder = append(plan.clusterOrder, meta.ID)
	}
	return plan, nil
}

func (a *App) canonicalClusterMeta(selection kubeconfigSelection, meta ClusterMeta) ClusterMeta {
	if clients := a.clusterClientsForID(meta.ID); clients != nil {
		return clients.meta
	}
	if clients := a.clusterClientsForSelection(selection); clients != nil {
		return clients.meta
	}
	return meta
}

type refreshSelectionUpdate struct {
	next map[string]*system.Subsystem
	new  map[string]*system.Subsystem
}

func (a *App) buildRefreshSelectionUpdate(
	plan refreshSelectionPlan,
	selections []kubeconfigSelection,
) (refreshSelectionUpdate, error) {
	update := refreshSelectionUpdate{
		next: make(map[string]*system.Subsystem, len(plan.desired)),
		new:  make(map[string]*system.Subsystem),
	}
	for id, selection := range plan.desired {
		if existing := a.getRefreshSubsystem(id); existing != nil {
			update.next[id] = existing
			continue
		}
		if err := a.buildNewRefreshSubsystem(&update, plan, selections, id, selection); err != nil {
			a.stopRefreshSubsystems(update.new)
			return refreshSelectionUpdate{}, err
		}
	}
	return update, nil
}

func (a *App) buildNewRefreshSubsystem(
	update *refreshSelectionUpdate,
	plan refreshSelectionPlan,
	selections []kubeconfigSelection,
	id string,
	selection kubeconfigSelection,
) error {
	clients, err := a.ensureClusterClients(id, selections)
	if err != nil {
		return err
	}
	if !a.canBuildRefreshSubsystem(id, plan.metaByID[id], clients) {
		return nil
	}
	subsystem, err := a.buildRefreshSubsystemForSelection(selection, clients, plan.metaByID[id])
	if err != nil {
		return err
	}
	update.next[id] = subsystem
	update.new[id] = subsystem
	return nil
}

func (a *App) ensureClusterClients(id string, selections []kubeconfigSelection) (*clusterClients, error) {
	clients := a.clusterClientsForID(id)
	if clients != nil {
		return clients, nil
	}
	if err := a.syncClusterClientPool(selections); err != nil {
		return nil, err
	}
	clients = a.clusterClientsForID(id)
	if clients == nil {
		return nil, fmt.Errorf("cluster clients unavailable for %s", id)
	}
	return clients, nil
}

func (a *App) canBuildRefreshSubsystem(id string, meta ClusterMeta, clients *clusterClients) bool {
	if clients.authFailedOnInit {
		a.appLogs.logger.Warn(fmt.Sprintf("Skipping subsystem for cluster %s: auth failed during initialization", meta.Name), logsources.Refresh, id, meta.Name)
		return false
	}
	if clients.authManager == nil || clients.authManager.IsValid() {
		return true
	}
	if a.appLogs.logger != nil {
		state, _ := clients.authManager.State()
		a.appLogs.logger.Warn(fmt.Sprintf("Skipping subsystem for cluster %s: auth not valid (state=%s)", meta.Name, state.String()), logsources.Refresh, id, meta.Name)
	}
	return false
}

func (a *App) applyRefreshSelectionUpdate(plan refreshSelectionPlan, update refreshSelectionUpdate) error {
	refreshCtx := a.currentRefreshRuntimeContext()
	if refreshCtx == nil {
		return fmt.Errorf("refresh runtime unavailable while applying selection update for clusters %s", strings.Join(plan.clusterOrder, ", "))
	}
	a.startRefreshSubsystems(refreshCtx, update.new)
	if err := a.refreshAggregates.Load().Update(plan.clusterOrder, update.next); err != nil {
		a.stopRefreshSubsystems(update.new)
		return err
	}
	previous := a.replaceRefreshSubsystems(update.next)
	a.startNewObjectCatalogs(plan, update.new)
	a.stopRemovedRefreshSubsystems(previous, update.next)
	return nil
}

func (a *App) startNewObjectCatalogs(plan refreshSelectionPlan, subsystems map[string]*system.Subsystem) {
	for id := range subsystems {
		target := catalogTarget{selection: plan.desired[id], meta: plan.metaByID[id]}
		if err := a.startObjectCatalogForTarget(target); err != nil {
			a.appLogs.logger.Warn(fmt.Sprintf("Object catalog skipped for %s: %v", id, err), logsources.ObjectCatalog, id, plan.metaByID[id].Name)
		}
	}
}

func (a *App) stopRemovedRefreshSubsystems(
	previous, next map[string]*system.Subsystem,
) {
	for id, subsystem := range previous {
		if _, kept := next[id]; kept {
			continue
		}
		a.stopRefreshPermissionRevalidation(id)
		a.stopRefreshSubsystem(subsystem)
		a.stopObjectCatalogForCluster(id)
	}
}

func (a *App) stopRefreshSubsystems(subsystems map[string]*system.Subsystem) {
	for clusterID, subsystem := range subsystems {
		a.stopRefreshPermissionRevalidation(clusterID)
		a.stopRefreshSubsystem(subsystem)
	}
}

func (a *App) stopRefreshSubsystem(subsystem *system.Subsystem) {
	if subsystem == nil {
		return
	}
	a.stopRefreshSubsystemResources(subsystem)
	if subsystem.Manager == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), config.RefreshShutdownTimeout)
	defer cancel()
	if err := subsystem.Manager.Shutdown(ctx); err != nil {
		a.appLogs.logger.Warn(fmt.Sprintf("Failed to shutdown refresh manager: %v", err), logsources.Refresh, subsystem.ClusterMeta.ClusterID, subsystem.ClusterMeta.ClusterName)
	}
}

// stopRefreshSubsystemResources cancels work owned directly by a subsystem
// generation. These resources can exist before Manager construction succeeds,
// so every teardown path must stop them independently of Manager availability.
func (a *App) stopRefreshSubsystemResources(subsystem *system.Subsystem) {
	if subsystem == nil {
		return
	}
	subsystem.CancelColdPreparation()
	subsystem.StopDoorbellNotifiers()
	if subsystem.ContainerLogs != nil {
		subsystem.ContainerLogs.Stop()
	}
	if subsystem.ResourceStream != nil {
		subsystem.ResourceStream.Stop()
	}
}
