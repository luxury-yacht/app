package backend

import (
	"context"
	"fmt"
	"time"

	"github.com/luxury-yacht/app/backend/refresh/system"
)

// updateRefreshSubsystemSelections updates active refresh subsystems without restarting the HTTP server.
func (a *App) updateRefreshSubsystemSelections(selections []kubeconfigSelection) error {
	if a == nil {
		return fmt.Errorf("app is nil")
	}
	if len(selections) == 0 {
		return nil
	}
	if a.refreshHTTPServer == nil || a.refreshAggregates == nil || a.refreshCtx == nil {
		return a.setupRefreshSubsystem()
	}

	clusterOrder := make([]string, 0, len(selections))
	desired := make(map[string]kubeconfigSelection, len(selections))
	metaByID := make(map[string]ClusterMeta, len(selections))
	for _, selection := range selections {
		meta := a.clusterMetaForSelection(selection)
		if meta.ID == "" {
			return fmt.Errorf("cluster identifier missing for selection %s", selection.String())
		}
		if _, exists := desired[meta.ID]; exists {
			continue
		}
		desired[meta.ID] = selection
		metaByID[meta.ID] = meta
		clusterOrder = append(clusterOrder, meta.ID)
	}

	nextSubsystems := make(map[string]*system.Subsystem, len(desired))
	newSubsystems := make(map[string]*system.Subsystem)

	for id, selection := range desired {
		if existing := a.refreshSubsystems[id]; existing != nil {
			nextSubsystems[id] = existing
			continue
		}
		clients := a.clusterClientsForID(id)
		if clients == nil {
			return fmt.Errorf("cluster clients unavailable for %s", id)
		}
		subsystem, err := a.buildRefreshSubsystemForSelection(selection, clients, metaByID[id])
		if err != nil {
			a.stopRefreshSubsystems(newSubsystems)
			return err
		}
		nextSubsystems[id] = subsystem
		newSubsystems[id] = subsystem
	}

	a.startRefreshSubsystems(a.refreshCtx, newSubsystems)

	if err := a.refreshAggregates.Update(clusterOrder, nextSubsystems); err != nil {
		a.stopRefreshSubsystems(newSubsystems)
		return err
	}

	previousSubsystems := a.refreshSubsystems
	a.refreshSubsystems = nextSubsystems

	for id := range newSubsystems {
		target := catalogTarget{
			selection: desired[id],
			meta:      metaByID[id],
		}
		if err := a.startObjectCatalogForTarget(target); err != nil && a.logger != nil {
			a.logger.Warn(fmt.Sprintf("Object catalog skipped for %s: %v", id, err), "ObjectCatalog")
		}
	}

	for id, subsystem := range previousSubsystems {
		if _, ok := nextSubsystems[id]; ok {
			continue
		}
		a.stopRefreshPermissionRevalidation(id)
		a.stopRefreshSubsystem(subsystem)
		a.stopObjectCatalogForCluster(id)
	}

	return nil
}

func (a *App) stopRefreshSubsystems(subsystems map[string]*system.Subsystem) {
	for clusterID, subsystem := range subsystems {
		a.stopRefreshPermissionRevalidation(clusterID)
		a.stopRefreshSubsystem(subsystem)
	}
}

func (a *App) stopRefreshSubsystem(subsystem *system.Subsystem) {
	if subsystem == nil || subsystem.Manager == nil {
		return
	}
	if subsystem.ResourceStream != nil {
		subsystem.ResourceStream.Stop()
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := subsystem.Manager.Shutdown(ctx); err != nil && a.logger != nil {
		a.logger.Warn(fmt.Sprintf("Failed to shutdown refresh manager: %v", err), "Refresh")
	}
}
