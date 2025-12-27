package snapshot

import (
	"context"
	"sync"
)

// ClusterMeta carries stable cluster identifiers for snapshot payloads.
type ClusterMeta struct {
	ClusterID   string `json:"clusterId"`
	ClusterName string `json:"clusterName"`
}

var (
	clusterMetaMu    sync.RWMutex
	currentMetaState ClusterMeta
)

type clusterMetaContextKey struct{}

// WithClusterMeta attaches cluster identifiers to the provided context.
func WithClusterMeta(ctx context.Context, meta ClusterMeta) context.Context {
	if ctx == nil {
		return context.WithValue(context.Background(), clusterMetaContextKey{}, meta)
	}
	return context.WithValue(ctx, clusterMetaContextKey{}, meta)
}

// ClusterMetaFromContext returns cluster identifiers from context or the fallback state.
func ClusterMetaFromContext(ctx context.Context) ClusterMeta {
	if ctx != nil {
		if meta, ok := ctx.Value(clusterMetaContextKey{}).(ClusterMeta); ok {
			return meta
		}
	}
	return CurrentClusterMeta()
}

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
