package backend

import "strings"

// markClusterWorkspaceChanged commits a mutation that can affect the aggregate
// workspace snapshot. Callers invoke it while still holding the lock that owns
// the changed source so a reader cannot observe the new value under the old
// revision.
func (p *ClusterWorkspaceProjection) markClusterWorkspaceChanged() {
	if p != nil {
		p.clusterWorkspaceRevision.Add(1)
	}
}

func (p *ClusterWorkspaceProjection) setClusterHealth(clusterID string, health ClusterHealthState) {
	if p == nil || strings.TrimSpace(clusterID) == "" {
		return
	}
	p.clusterWorkspaceMu.Lock()
	if p.clusterHealth == nil {
		p.clusterHealth = make(map[string]ClusterHealthState)
	}
	if p.clusterHealth[clusterID] != health {
		p.clusterHealth[clusterID] = health
		p.markClusterWorkspaceChanged()
	}
	p.clusterWorkspaceMu.Unlock()
}

func (p *ClusterWorkspaceProjection) incrementClusterScopeRevision(clusterID string) {
	if p == nil || strings.TrimSpace(clusterID) == "" {
		return
	}
	p.clusterWorkspaceMu.Lock()
	if p.clusterScopeRevisions == nil {
		p.clusterScopeRevisions = make(map[string]uint64)
	}
	p.clusterScopeRevisions[clusterID]++
	p.markClusterWorkspaceChanged()
	p.clusterWorkspaceMu.Unlock()
}

func (p *ClusterWorkspaceProjection) removeClusterWorkspaceRuntimeState(clusterID string) {
	if p == nil || clusterID == "" {
		return
	}
	p.clusterWorkspaceMu.Lock()
	_, hadHealth := p.clusterHealth[clusterID]
	_, hadScopeRevision := p.clusterScopeRevisions[clusterID]
	delete(p.clusterHealth, clusterID)
	delete(p.clusterScopeRevisions, clusterID)
	if hadHealth || hadScopeRevision {
		p.markClusterWorkspaceChanged()
	}
	p.clusterWorkspaceMu.Unlock()
}

func (p *ClusterWorkspaceProjection) clusterWorkspaceRuntimeState() (map[string]ClusterHealthState, map[string]uint64) {
	p.clusterWorkspaceMu.RLock()
	defer p.clusterWorkspaceMu.RUnlock()
	health := make(map[string]ClusterHealthState, len(p.clusterHealth))
	for clusterID, state := range p.clusterHealth {
		health[clusterID] = state
	}
	revisions := make(map[string]uint64, len(p.clusterScopeRevisions))
	for clusterID, revision := range p.clusterScopeRevisions {
		revisions[clusterID] = revision
	}
	return health, revisions
}
