// Store resource versions used by snapshots that join retained ingest projections.
package snapshot

import "k8s.io/apimachinery/pkg/runtime/schema"

// ingestVersionSource exposes only the watermark required by version consumers.
type ingestVersionSource interface {
	StoreResourceVersion(gvr schema.GroupVersionResource) string
}

// ingestStoreVersion returns zero for an absent source or a nonnumeric watermark.
func ingestStoreVersion(source ingestVersionSource, gvr schema.GroupVersionResource) uint64 {
	if source == nil {
		return 0
	}
	return parseSnapshotResourceVersion(source.StoreResourceVersion(gvr))
}

func maxIngestStoreVersion(source ingestVersionSource, gvrs ...schema.GroupVersionResource) uint64 {
	var version uint64
	for _, gvr := range gvrs {
		version = max(version, ingestStoreVersion(source, gvr))
	}
	return version
}
