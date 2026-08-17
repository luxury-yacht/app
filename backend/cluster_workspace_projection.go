package backend

import (
	"sync"
	"sync/atomic"
)

// ClusterWorkspaceProjection is the leaf owner of replayable per-cluster
// health and namespace-scope revision state. Source owners write through its
// narrow methods; it never owns clients, selections, or refresh subsystems.
type ClusterWorkspaceProjection struct {
	clusterWorkspaceMu       sync.RWMutex
	clusterWorkspaceRevision atomic.Uint64
	clusterHealth            map[string]ClusterHealthState
	clusterScopeRevisions    map[string]uint64
}

func newClusterWorkspaceProjection() *ClusterWorkspaceProjection {
	return &ClusterWorkspaceProjection{
		clusterHealth:         make(map[string]ClusterHealthState),
		clusterScopeRevisions: make(map[string]uint64),
	}
}
