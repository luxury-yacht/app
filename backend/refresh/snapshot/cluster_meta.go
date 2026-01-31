package snapshot

import (
	"context"
	"log"
)

// ClusterMeta carries stable cluster identifiers for snapshot payloads.
type ClusterMeta struct {
	ClusterID   string `json:"clusterId"`
	ClusterName string `json:"clusterName"`
}

type clusterMetaContextKey struct{}

// WithClusterMeta attaches cluster identifiers to the provided context.
func WithClusterMeta(ctx context.Context, meta ClusterMeta) context.Context {
	if ctx == nil {
		return context.WithValue(context.Background(), clusterMetaContextKey{}, meta)
	}
	return context.WithValue(ctx, clusterMetaContextKey{}, meta)
}

// ClusterMetaFromContext returns cluster identifiers from context, or an empty
// ClusterMeta if the context is nil or missing cluster meta. In multi-cluster mode,
// callers must ensure context is properly scoped via WithClusterMeta.
func ClusterMetaFromContext(ctx context.Context) ClusterMeta {
	if ctx == nil {
		log.Println("snapshot: ClusterMetaFromContext called with nil context")
		return ClusterMeta{}
	}
	if meta, ok := ctx.Value(clusterMetaContextKey{}).(ClusterMeta); ok {
		return meta
	}
	log.Println("snapshot: ClusterMetaFromContext called with context missing cluster meta")
	return ClusterMeta{}
}
