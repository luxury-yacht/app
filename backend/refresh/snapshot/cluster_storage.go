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
func RegisterClusterStorageDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	clusterMeta ClusterMeta,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	collectIndexer := unconditionalSharedIndexers(factory, clusterStorageDomainName)

	// Maintain a per-cluster store fed by each available storage kind's informer.
	maintained := newTypedMaintainedStore(clusterMeta, clusterStorageQuerypageSchema(), clusterStorageTableQueryAdapter())
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

	var entries []ClusterStorageEntry
	var sources []typedTableResourceSource
	var version uint64
	if b.maintained != nil {
		// Serve projected rows straight from the informer-fed store (no re-listing /
		// re-projecting); availability + sources mirror the list path exactly. The
		// domain is cluster-scoped, so the store is queried for all rows ("").
		var available map[string]bool
		sources, available = b.clusterStorageSources(ctx)
		entries = b.maintained.rows("", available)
		version = b.maintained.snapshotVersion()
	} else {
		var err error
		entries, sources, version, err = collectDescriptorTableRows[ClusterStorageEntry](ctx, clusterStorageDomainName, b.collectIndexer, meta, "")
		if err != nil {
			return nil, fmt.Errorf("cluster storage: failed to list persistent volumes: %w", err)
		}
	}

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name < entries[j].Name
	})

	resolved := resolveTypedSnapshotPageViaStore(
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
