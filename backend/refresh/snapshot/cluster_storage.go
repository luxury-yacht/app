package snapshot

import (
	"context"
	"fmt"
	"sort"

	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/querypage"
	"github.com/luxury-yacht/app/backend/resources/persistentvolume"
)

const clusterStorageDomainName = "cluster-storage"

// ClusterStorageBuilder constructs PersistentVolume summaries via the shared
// typed-table domain skeleton (typed_table_domain.go).
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

func clusterStorageDomainSpec() typedTableDomainSpec[ClusterStorageEntry] {
	return typedTableDomainSpec[ClusterStorageEntry]{
		domain:       clusterStorageDomainName,
		entryLimit:   config.SnapshotClusterStorageEntryLimit,
		description:  "persistent volumes",
		adapter:      clusterStorageTableQueryAdapter(),
		schema:       clusterStorageQuerypageSchema(),
		capabilities: clusterStorageQueryCapabilities(),
		kindOf:       func(entry ClusterStorageEntry) string { return entry.Kind },
		sortRows:     sortClusterStorageEntries,
	}
}

func sortClusterStorageEntries(entries []ClusterStorageEntry) {
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name < entries[j].Name
	})
}

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
	maintained, err := newRegisteredTypedTableStore(reg, clusterStorageDomainSpec(), clusterMeta, collectIndexer, factory, nil, ingestManager)
	if err != nil {
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

// Build creates a snapshot of persistent volumes.
func (b *ClusterStorageBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	return buildTypedTableSnapshot(ctx, scope, clusterStorageDomainSpec(), b.collectIndexer, b.maintained,
		func(meta ClusterMeta, envelope ResourceQueryEnvelope, rows []ClusterStorageEntry) any {
			return ClusterStorageSnapshot{ClusterMeta: meta, ResourceQueryEnvelope: envelope, Rows: rows}
		})
}
