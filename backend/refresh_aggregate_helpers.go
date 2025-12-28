package backend

import (
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/system"
)

// collectEventManagers extracts per-cluster event managers for aggregate streaming.
func collectEventManagers(subsystems map[string]*system.Subsystem) map[string]eventStreamSubscriber {
	managers := make(map[string]eventStreamSubscriber)
	for id, subsystem := range subsystems {
		if subsystem == nil || subsystem.EventStream == nil {
			continue
		}
		managers[id] = subsystem.EventStream
	}
	return managers
}

// collectClusterMeta extracts cluster identifiers for aggregate stream annotations.
func collectClusterMeta(subsystems map[string]*system.Subsystem) map[string]snapshot.ClusterMeta {
	meta := make(map[string]snapshot.ClusterMeta)
	for id, subsystem := range subsystems {
		if subsystem == nil {
			continue
		}
		meta[id] = subsystem.ClusterMeta
	}
	return meta
}
