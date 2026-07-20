package backend

import "github.com/luxury-yacht/app/backend/refresh/system"

func copyRefreshSubsystems(subsystems map[string]*system.Subsystem) map[string]*system.Subsystem {
	if len(subsystems) == 0 {
		return make(map[string]*system.Subsystem)
	}
	copied := make(map[string]*system.Subsystem, len(subsystems))
	for id, subsystem := range subsystems {
		copied[id] = subsystem
	}
	return copied
}

func (a *App) getRefreshSubsystem(clusterID string) *system.Subsystem {
	if a == nil || clusterID == "" {
		return nil
	}
	a.refreshSubsystemsMu.RLock()
	defer a.refreshSubsystemsMu.RUnlock()
	return a.refreshSubsystems[clusterID]
}

func (a *App) setRefreshSubsystem(clusterID string, subsystem *system.Subsystem) {
	if a == nil || clusterID == "" {
		return
	}
	a.refreshSubsystemsMu.Lock()
	if a.refreshSubsystems == nil {
		a.refreshSubsystems = make(map[string]*system.Subsystem)
	}
	a.refreshSubsystems[clusterID] = subsystem
	a.refreshSubsystemsMu.Unlock()
	a.syncAttentionIgnoreRulesForSubsystem(clusterID, subsystem)
}

// swapRefreshSubsystem stores next as clusterID's subsystem and STOPS the
// previous one. Rebuild paths must use this instead of setRefreshSubsystem:
// overwriting the map entry leaks the old subsystem whole — its manager,
// informer factory, ingest reflectors, and namespace notifier keep running on
// stale transports (observed live as duplicate namespaces-doorbell broadcasts
// to a subscriber-less manager). Next is stored FIRST so the aggregate mux
// never routes to a stopped subsystem.
func (a *App) swapRefreshSubsystem(clusterID string, next *system.Subsystem) {
	if a == nil || clusterID == "" {
		return
	}
	previous := a.getRefreshSubsystem(clusterID)
	a.setRefreshSubsystem(clusterID, next)
	if previous == nil || previous == next {
		return
	}
	previous.CancelColdPreparation()
	// stopRefreshSubsystem no-ops without a manager; silence the doorbell
	// notifiers explicitly so a partially-built previous subsystem cannot keep
	// them.
	previous.StopDoorbellNotifiers()
	a.stopRefreshSubsystem(previous)
}

func (a *App) takeRefreshSubsystem(clusterID string) *system.Subsystem {
	if a == nil || clusterID == "" {
		return nil
	}
	a.refreshSubsystemsMu.Lock()
	defer a.refreshSubsystemsMu.Unlock()
	subsystem := a.refreshSubsystems[clusterID]
	delete(a.refreshSubsystems, clusterID)
	return subsystem
}

func (a *App) snapshotRefreshSubsystems() map[string]*system.Subsystem {
	if a == nil {
		return make(map[string]*system.Subsystem)
	}
	a.refreshSubsystemsMu.RLock()
	defer a.refreshSubsystemsMu.RUnlock()
	return copyRefreshSubsystems(a.refreshSubsystems)
}

func (a *App) replaceRefreshSubsystems(next map[string]*system.Subsystem) map[string]*system.Subsystem {
	if a == nil {
		return make(map[string]*system.Subsystem)
	}
	a.refreshSubsystemsMu.Lock()
	previous := copyRefreshSubsystems(a.refreshSubsystems)
	a.refreshSubsystems = copyRefreshSubsystems(next)
	a.refreshSubsystemsMu.Unlock()
	for clusterID, subsystem := range next {
		a.syncAttentionIgnoreRulesForSubsystem(clusterID, subsystem)
	}
	return previous
}
