package backend

// ClusterMeta captures stable cluster identifiers for cache and payload scoping.
type ClusterMeta struct {
	ID   string
	Name string
}

func (m *ClusterRuntimeManager) clusterNameForID(clusterID string) string {
	if m == nil || clusterID == "" {
		return ""
	}
	if clients := m.clusterClientsForID(clusterID); clients != nil {
		return clients.meta.Name
	}
	return ""
}
