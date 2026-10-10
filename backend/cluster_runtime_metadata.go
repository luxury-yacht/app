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
	// A cluster can be logged about before its clients exist (or after they are
	// removed); its kubeconfig discovery entry still names it.
	m.discoveryMu.RLock()
	defer m.discoveryMu.RUnlock()
	for _, kc := range m.availableKubeconfigs {
		if meta := clusterMetaForKubeconfig(kc); meta.ID == clusterID {
			return meta.Name
		}
	}
	return ""
}
