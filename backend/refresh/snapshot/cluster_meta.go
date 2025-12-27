package snapshot

import "sync"

// ClusterMeta carries stable cluster identifiers for snapshot payloads.
type ClusterMeta struct {
	ClusterID   string `json:"clusterId"`
	ClusterName string `json:"clusterName"`
}

var (
	clusterMetaMu    sync.RWMutex
	currentMetaState ClusterMeta
)

// SetClusterMeta updates the process-wide cluster identifiers for snapshot payloads.
func SetClusterMeta(clusterID, clusterName string) {
	clusterMetaMu.Lock()
	defer clusterMetaMu.Unlock()
	currentMetaState = ClusterMeta{ClusterID: clusterID, ClusterName: clusterName}
}

// CurrentClusterMeta returns the latest cluster identifiers for snapshot payloads.
func CurrentClusterMeta() ClusterMeta {
	clusterMetaMu.RLock()
	defer clusterMetaMu.RUnlock()
	return currentMetaState
}
