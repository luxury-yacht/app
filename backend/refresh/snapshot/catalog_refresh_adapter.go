package snapshot

import (
	"time"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh"
)

func (b *catalogBuilder) buildSnapshot(
	service *objectcatalog.Service,
	meta ClusterMeta,
	scope string,
	opts objectcatalog.QueryOptions,
) *refresh.Snapshot {
	cachesReady := service.CachesReady()
	payload, truncated := b.buildPayload(service, meta, opts, cachesReady)
	if cachesReady && payload.Total > 0 {
		// Streaming caches are warm, but snapshot callers still page through
		// explicitly limited scopes. Preserve the continue token and batch shape
		// so Browse can keep requesting additional pages.
		if payload.Continue == "" {
			payload.IsFinal = true
			if payload.TotalBatches == 0 {
				payload.TotalBatches = 1
			}
		} else {
			payload.IsFinal = false
		}
	}

	return &refresh.Snapshot{
		Domain:  b.domain,
		Scope:   scope,
		Version: uint64(time.Now().UnixNano()),
		Payload: payload,
		Stats:   buildCatalogSnapshotStats(payload, truncated),
	}
}

func (b *catalogBuilder) buildPayload(
	service *objectcatalog.Service,
	meta ClusterMeta,
	opts objectcatalog.QueryOptions,
	forceFinal bool,
) (CatalogSnapshot, bool) {
	result := service.Query(opts)
	health := service.Health()
	cachesReady := service.CachesReady()

	payload, truncated := buildCatalogSnapshot(result, opts, health, cachesReady, forceFinal)
	payload.ClusterMeta = meta
	payload.ResourceFamilies = service.DiscoveredResourceFamilies()
	payload.NamespaceGroups = buildCatalogNamespaceGroups(
		service,
		meta,
		b.namespaceGroups,
		opts.Namespaces,
	)
	if latency := service.FirstBatchLatency(); latency > 0 {
		payload.FirstBatchLatencyMs = latency.Milliseconds()
	}

	return payload, truncated
}

func buildCatalogSnapshotStats(
	payload CatalogSnapshot,
	truncated bool,
) refresh.SnapshotStats {
	stats := refresh.SnapshotStats{
		ItemCount:    len(payload.Items),
		TotalItems:   payload.Total,
		Truncated:    truncated,
		BatchIndex:   payload.BatchIndex,
		BatchSize:    payload.BatchSize,
		TotalBatches: payload.TotalBatches,
		IsFinalBatch: payload.IsFinal,
	}
	if payload.FirstBatchLatencyMs > 0 {
		stats.TimeToFirstRowMs = payload.FirstBatchLatencyMs
	}
	return stats
}
