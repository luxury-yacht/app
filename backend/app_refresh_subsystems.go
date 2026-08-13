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

// swapRefreshSubsystem stores next as clusterID's subsystem and stops the
// previous one. It is only suitable when no live aggregate route still points
// at previous; routed rebuilds must update that route before stopping it.
func (a *App) swapRefreshSubsystem(clusterID string, next *system.Subsystem) {
	if a == nil || clusterID == "" {
		return
	}
	previous := a.getRefreshSubsystem(clusterID)
	a.setRefreshSubsystem(clusterID, next)
	if previous == nil || previous == next {
		return
	}
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
