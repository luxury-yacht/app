/*
 * backend/refresh/snapshot/cluster_meta.go
 *
 * Carries validated cluster identity through snapshot builds so every refresh
 * payload can be attributed to the cluster that produced it.
 */

package snapshot

import (
	"context"
	"log"

	"github.com/luxury-yacht/app/backend/refresh/streamrows"
)

// ClusterMeta carries stable cluster identifiers for snapshot payloads. The type
// lives in the streamrows leaf package so resources/<kind> packages can own their
// stream-summary builders without importing snapshot; this alias keeps the
// snapshot-side name, methods, and wire JSON unchanged.
type ClusterMeta = streamrows.ClusterMeta

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
