package snapshot

import (
	"time"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh"
)

type catalogRefreshAdapter struct {
	service         *objectcatalog.Service
	clusterMeta     ClusterMeta
	namespaceGroups func() []CatalogNamespaceGroup
}

type catalogRefreshAssembly struct {
	result       objectcatalog.QueryResult
	payload      CatalogSnapshot
	stats        refresh.SnapshotStats
	truncated    bool
	snapshotMode catalogStreamSnapshotMode
}

func newCatalogRefreshAdapter(
	service *objectcatalog.Service,
	clusterMeta ClusterMeta,
	namespaceGroups func() []CatalogNamespaceGroup,
) catalogRefreshAdapter {
	return catalogRefreshAdapter{
		service:         service,
		clusterMeta:     clusterMeta,
		namespaceGroups: namespaceGroups,
	}
}

func (a catalogRefreshAdapter) BuildSnapshot(
	domainName string,
	scope string,
	opts browseQueryOptions,
) *refresh.Snapshot {
	cachesReady := a.service.CachesReady()
	assembly := a.assemble(opts, cachesReady)
	if cachesReady && assembly.payload.Total > 0 {
		// Streaming caches are warm, but snapshot callers still page through
		// explicitly limited scopes. Preserve the continue token and batch shape
		// so Browse can keep requesting additional pages.
		if assembly.payload.Continue == "" {
			assembly.payload.IsFinal = true
			if assembly.payload.TotalBatches == 0 {
				assembly.payload.TotalBatches = 1
			}
		} else {
			assembly.payload.IsFinal = false
		}
		assembly.payload.BatchSize = len(assembly.payload.Items)
		assembly.stats = buildCatalogSnapshotStats(
			assembly.payload,
			assembly.result.TotalItems,
			assembly.truncated,
		)
	}

	return &refresh.Snapshot{
		Domain:  domainName,
		Scope:   scope,
		Version: uint64(time.Now().UnixNano()),
		Payload: assembly.payload,
		Stats:   assembly.stats,
	}
}

func (a catalogRefreshAdapter) BuildStreamEvent(
	opts browseQueryOptions,
	ready bool,
	reset bool,
	sequence uint64,
) catalogStreamEvent {
	assembly := a.assemble(opts, ready)
	return catalogStreamEvent{
		Reset:        reset,
		Ready:        ready && assembly.payload.IsFinal,
		CacheReady:   a.service.CachesReady(),
		Truncated:    assembly.truncated,
		SnapshotMode: assembly.snapshotMode,
		Snapshot:     assembly.payload,
		Stats:        assembly.stats,
		GeneratedAt:  time.Now().UnixMilli(),
		Sequence:     sequence,
	}
}

func (a catalogRefreshAdapter) assemble(
	opts browseQueryOptions,
	forceFinal bool,
) catalogRefreshAssembly {
	result := a.service.Query(opts.toQueryOptions())
	health := a.service.Health()
	cachesReady := a.service.CachesReady()

	payload, truncated := buildCatalogSnapshot(result, opts, health, cachesReady, forceFinal)
	payload.ClusterMeta = a.clusterMeta
	payload.NamespaceGroups = buildCatalogNamespaceGroups(
		a.service,
		a.clusterMeta,
		a.namespaceGroups,
		opts.Namespaces,
	)
	if latency := a.service.FirstBatchLatency(); latency > 0 {
		payload.FirstBatchLatencyMs = latency.Milliseconds()
	}

	stats := buildCatalogSnapshotStats(payload, result.TotalItems, truncated)
	snapshotMode := catalogStreamSnapshotFull
	if !payload.IsFinal || truncated {
		snapshotMode = catalogStreamSnapshotPartial
	}

	return catalogRefreshAssembly{
		result:       result,
		payload:      payload,
		stats:        stats,
		truncated:    truncated,
		snapshotMode: snapshotMode,
	}
}

func buildCatalogSnapshotStats(
	payload CatalogSnapshot,
	totalItems int,
	truncated bool,
) refresh.SnapshotStats {
	stats := refresh.SnapshotStats{
		ItemCount:    len(payload.Items),
		TotalItems:   totalItems,
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
