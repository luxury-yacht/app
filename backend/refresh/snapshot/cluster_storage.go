package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strings"

	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/querypage"
	"github.com/luxury-yacht/app/backend/resources/persistentvolume"
)

const clusterStorageDomainName = "cluster-storage"

// ClusterStorageBuilder constructs PersistentVolume summaries by listing the
// kind's informer indexer and projecting it via the pv package's stream-summary
// builder; Build loops the stream descriptor registry via collectDescriptorTableRows.
type ClusterStorageBuilder struct {
	collectIndexer func(streamspec.Descriptor) cache.Indexer
	// maintained, when set, is an informer-fed store the builder serves rows from
	// instead of listing + re-projecting per request. nil falls back to the list path.
	maintained *typedMaintainedStore[ClusterStorageEntry]
}

// clusterStorageQuerypageSchema derives the querypage Schema for the cluster storage
// table from the existing typed-table adapter, via the shared generic schema builder.
// It REUSES the adapter's exact comparable sort-value encoder and row key, so the
// querypage engine orders rows byte-identically to the live typed-table executor.
func clusterStorageQuerypageSchema() querypage.Schema[ClusterStorageEntry] {
	return querypageSchemaFromAdapter(clusterStorageTableQueryAdapter(), []string{"name", "kind", "storageClass", "capacity", "accessModes", "status", "claim", "age"})
}

// ClusterStorageSnapshot is the payload exposed to the frontend. It embeds the
// canonical ResourceQueryEnvelope (flattened into the top-level JSON) and adds
// the domain-typed rows, so every backend-query table presents one shape.
type ClusterStorageSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows []ClusterStorageEntry `json:"rows"`
}

// clusterStorageQueryCapabilities reports the backend-supported global table
// behavior for the cluster storage table (matching clusterStorageTableQueryAdapter).
func clusterStorageQueryCapabilities() ResourceQueryCapabilities {
	return newTypedResourceCapabilities(
		[]string{"name", "kind", "storageClass", "capacity", "accessModes", "status", "claim", "age"},
		[]string{"kinds"},
		[]string{"kind", "name", "storageClass", "capacity", "accessModes", "status", "claim"},
		[]string{persistentvolume.Identity.Kind},
	)
}

// ClusterStorageEntry represents a persistent volume in the cluster view. The
// type lives in the streamrows leaf so the pv package can build it; this alias
// keeps the snapshot-side name and wire JSON unchanged.
type ClusterStorageEntry = streamrows.ClusterStorageEntry

// RegisterClusterStorageDomain registers the storage domain.
//
// PersistentVolume is an owned-reflector ingest kind (IngestOwned): when ingestManager
// is non-nil its maintained-store feed comes from the ingest reflector's Table-half
// Sink and registerMaintainedHandlers skips it (the shared factory no longer caches
// it). When ingestManager is nil (a unit test) the store has no feed for the cut kind.
func RegisterClusterStorageDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	clusterMeta ClusterMeta,
	ingestManager *ingest.IngestManager,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	collectIndexer := unconditionalSharedIndexers(factory, clusterStorageDomainName, ingestManager)

	// Maintain a per-cluster store fed by each available storage kind's source: the
	// ingest Sink for cut kinds, the shared-informer handler for any uncut kind.
	maintained := newTypedMaintainedStore(clusterMeta, clusterStorageQuerypageSchema(), clusterStorageTableQueryAdapter())
	reg.RegisterMaintainedStore(clusterStorageDomainName, maintained) // spill/restore/reconcile across Cold/re-warm
	feedMaintainedFromIngest(maintained, clusterStorageDomainName, ingestManager)
	if err := registerMaintainedHandlers(maintained, clusterStorageDomainName, collectIndexer, factory, nil); err != nil {
		return err
	}

	builder := &ClusterStorageBuilder{
		collectIndexer: collectIndexer,
		maintained:     maintained,
	}
	return reg.Register(refresh.DomainConfig{
		Name:          clusterStorageDomainName,
		BuildSnapshot: builder.Build,
	})
}

// clusterStorageSources computes per-descriptor availability for THIS request
// (indexer present AND runtimeResourceAllowed), returning the snapshot sources and a
// Kind→available map — the same gating collectDescriptorTableRows applies, so the
// maintained-store path and the list path agree on which kinds are visible.
func (b *ClusterStorageBuilder) clusterStorageSources(ctx context.Context) ([]typedTableResourceSource, map[string]bool) {
	descriptors := kindregistry.StreamDescriptorsForDomain(clusterStorageDomainName)
	sources := make([]typedTableResourceSource, 0, len(descriptors))
	available := make(map[string]bool, len(descriptors))
	for _, d := range descriptors {
		ok := b.collectIndexer(d) != nil && runtimeResourceAllowed(ctx, clusterStorageDomainName, d.Group, d.Resource)
		sources = append(sources, typedTableResourceSource{
			Kind:      d.Kind,
			Group:     d.Group,
			Resource:  d.Resource,
			Available: ok,
		})
		available[d.Kind] = ok
	}
	return sources, available
}

// Build creates a snapshot of persistent volumes.
func (b *ClusterStorageBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	_, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(trimmed), clusterStorageDomainName, "")
	if err != nil {
		return nil, err
	}

	sortClusterStorageEntries := func(entries []ClusterStorageEntry) {
		sort.Slice(entries, func(i, j int) bool {
			return entries[i].Name < entries[j].Name
		})
	}

	var resolved typedSnapshotPage[ClusterStorageEntry]
	var version uint64
	if b.maintained != nil {
		// Serve the query straight from the informer-fed store, querying it in place
		// (O(log N + page)) rather than snapshotting + rebuilding a per-Build store. The
		// domain is cluster-scoped, so the store is queried for all rows ("").
		sources, available := b.clusterStorageSources(ctx)
		resolved = resolveMaintainedDirect(
			b.maintained.store,
			query,
			available,
			"",
			clusterStorageTableQueryAdapter(),
			clusterStorageQuerypageSchema(),
			capabilitiesWithAvailableKinds(clusterStorageQueryCapabilities(), sources),
			config.SnapshotClusterStorageEntryLimit,
			"persistent volumes",
			func(entry ClusterStorageEntry) string { return entry.Kind },
			func() []ClusterStorageEntry {
				rows := b.maintained.rows("", available)
				sortClusterStorageEntries(rows)
				return rows
			},
			typedTableQueryResourceIssues(ctx, clusterStorageDomainName, query, sources),
		)
		version = b.maintained.snapshotVersion()
	} else {
		entries, sources, v, listErr := collectDescriptorTableRows[ClusterStorageEntry](ctx, clusterStorageDomainName, b.collectIndexer, meta, "")
		if listErr != nil {
			return nil, fmt.Errorf("cluster storage: failed to list persistent volumes: %w", listErr)
		}
		version = v
		sortClusterStorageEntries(entries)
		resolved = resolveTypedSnapshotPageViaStore(
			clusterStorageDomainName,
			entries,
			query,
			clusterStorageTableQueryAdapter(),
			clusterStorageQuerypageSchema(),
			capabilitiesWithAvailableKinds(clusterStorageQueryCapabilities(), sources),
			config.SnapshotClusterStorageEntryLimit,
			"persistent volumes",
			func(entry ClusterStorageEntry) string { return entry.Kind },
			typedTableQueryResourceIssues(ctx, clusterStorageDomainName, query, sources),
		)
	}
	// The window snapshot is the canonical unscoped refresh payload; only the
	// query page publishes the request scope.
	snapshotScope := ""
	if query.Enabled {
		snapshotScope = refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed))
	}
	return &refresh.Snapshot{
		Domain:  clusterStorageDomainName,
		Scope:   snapshotScope,
		Version: version,
		Payload: ClusterStorageSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: resolved.Envelope,
			Rows:                  resolved.Rows,
		},
		Stats: resolved.Stats,
	}, nil
}
