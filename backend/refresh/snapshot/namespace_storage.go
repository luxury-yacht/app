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
	"github.com/luxury-yacht/app/backend/resources/persistentvolumeclaim"
)

const (
	namespaceStorageDomainName       = "namespace-storage"
	errNamespaceStorageScopeRequired = "namespace scope is required"
)

// NamespaceStorageBuilder constructs PVC summaries for a namespace via the shared
// typed-table domain skeleton (typed_table_domain.go).
type NamespaceStorageBuilder struct {
	collectIndexer func(streamspec.Descriptor) cache.Indexer
	// maintained, when set, is an informer-fed store the builder serves rows from
	// instead of listing + re-projecting per request. nil falls back to the list path.
	maintained *typedMaintainedStore[StorageSummary]
}

// storageQuerypageSchema derives the querypage Schema for the storage table from the
// existing typed-table adapter, via the shared generic schema builder. It REUSES the
// adapter's exact comparable sort-value encoder and row key, so the querypage engine
// orders rows byte-identically to the live typed-table executor.
func storageQuerypageSchema() querypage.Schema[StorageSummary] {
	return querypageSchemaFromAdapter(storageTableQueryAdapter(), []string{"name", "kind", "namespace", "capacity", "status", "storageClass", "age"})
}

// NamespaceStorageSnapshot payload for storage tab.
type NamespaceStorageSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows []StorageSummary `json:"rows"`
}

func namespaceStorageQueryCapabilities() ResourceQueryCapabilities {
	return newTypedResourceCapabilities(
		[]string{"name", "kind", "namespace", "capacity", "status", "storageClass", "age"},
		[]string{"kinds", "namespaces"},
		[]string{"kind", "name", "namespace", "capacity", "status", "storageClass"},
		[]string{persistentvolumeclaim.Identity.Kind},
	)
}

// StorageSummary captures PVC info for UI consumption. The type lives in the
// streamrows leaf so the pvc package can build it; this alias keeps the
// snapshot-side name and wire JSON unchanged.
type StorageSummary = streamrows.StorageSummary

func namespaceStorageDomainSpec() typedTableDomainSpec[StorageSummary] {
	return typedTableDomainSpec[StorageSummary]{
		domain:           namespaceStorageDomainName,
		scopeRequiredErr: errNamespaceStorageScopeRequired,
		entryLimit:       config.SnapshotNamespaceStorageEntryLimit,
		description:      "storage resources",
		listErrorPrefix:  "namespace storage: failed to list pvcs",
		adapter:          storageTableQueryAdapter(),
		schema:           storageQuerypageSchema(),
		capabilities:     namespaceStorageQueryCapabilities(),
		kindOf:           func(resource StorageSummary) string { return resource.Ref.Kind },
		sortRows:         sortStorageSummaries,
	}
}

func sortStorageSummaries(resources []StorageSummary) {
	sort.Slice(resources, func(i, j int) bool {
		if resources[i].Ref.Namespace == resources[j].Ref.Namespace {
			return resources[i].Ref.Name < resources[j].Ref.Name
		}
		return resources[i].Ref.Namespace < resources[j].Ref.Namespace
	})
}

// RegisterNamespaceStorageDomain registers the storage domain.
//
// PersistentVolumeClaim is an owned-reflector ingest kind (IngestOwned): when
// ingestManager is non-nil its maintained-store feed comes from the ingest reflector's
// Table-half Sink, and registerMaintainedHandlers skips it (the shared factory no
// longer caches it). When ingestManager is nil (a unit test) the store has no feed for
// the cut kind, mirroring the quotas domain.
func RegisterNamespaceStorageDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	clusterMeta ClusterMeta,
	ingestManager *ingest.IngestManager,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	collectIndexer := unconditionalSharedIndexers(factory, namespaceStorageDomainName, ingestManager)
	maintained, err := newRegisteredTypedTableStore(reg, namespaceStorageDomainSpec(), clusterMeta, collectIndexer, factory, nil, ingestManager)
	if err != nil {
		return err
	}

	builder := &NamespaceStorageBuilder{
		collectIndexer: collectIndexer,
		maintained:     maintained,
	}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceStorageDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build assembles PVC summaries for the namespace.
func (b *NamespaceStorageBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	return buildTypedTableSnapshot(ctx, scope, namespaceStorageDomainSpec(), b.collectIndexer, b.maintained,
		func(meta ClusterMeta, envelope ResourceQueryEnvelope, rows []StorageSummary) any {
			return NamespaceStorageSnapshot{ClusterMeta: meta, ResourceQueryEnvelope: envelope, Rows: rows}
		})
}
