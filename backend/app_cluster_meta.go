package backend

// ClusterMeta captures stable cluster identifiers for cache and payload scoping.
type ClusterMeta struct {
	ID   string
	Name string
}

func (a *App) clusterNameForID(clusterID string) string {
	if a == nil || clusterID == "" {
		return ""
	}
	if clients := a.clusterClientsForID(clusterID); clients != nil {
		return clients.meta.Name
	}
	return ""
}
