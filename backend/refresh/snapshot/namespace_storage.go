package snapshot

import (
	"context"
	"sort"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/doorbell"
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
	available kindAvailability
	// maintained, when set, is a reflector-fed store the builder serves rows from
	// instead of listing + re-projecting per request. nil falls back to the list path.
	maintained *typedMaintainedStore[StorageSummary]
}

// storageQuerypageSchema derives the querypage Schema for the storage table from the
// existing typed-table adapter, via the shared generic schema builder. It REUSES the
// adapter's exact comparable sort-value encoder and row key, so the querypage engine
// orders rows byte-identically to the live typed-table executor.
func storageQuerypageSchema() querypage.Schema[StorageSummary] {
	return querypageSchemaFromAdapter(storageTableQueryAdapter(), namespaceStorageQueryCapabilities().SortableFields)
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
		adapter:          storageTableQueryAdapter(),
		schema:           storageQuerypageSchema(),
		capabilities:     namespaceStorageQueryCapabilities(),
		sortRows:         sortStorageSummaries,
		payload: func(meta ClusterMeta, envelope ResourceQueryEnvelope, rows []StorageSummary) any {
			return NamespaceStorageSnapshot{ClusterMeta: meta, ResourceQueryEnvelope: envelope, Rows: rows}
		},
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
// PersistentVolumeClaim feeds the maintained store from its owned reflector's
// Table-half sink. When ingestManager is nil (a unit test) the store has no feed,
// mirroring the quotas domain.
func RegisterNamespaceStorageDomain(
	reg *domain.Registry,
	clusterMeta ClusterMeta,
	ingestManager *ingest.IngestManager,
	bell doorbell.Bell,
) error {
	available := unconditionalIngestAvailability(namespaceStorageDomainName, ingestManager)
	maintained, err := newRegisteredTypedTableStore(reg, namespaceStorageDomainSpec(), clusterMeta,
		ingestManager, bell)
	if err != nil {
		return err
	}

	builder := &NamespaceStorageBuilder{
		available:  available,
		maintained: maintained,
	}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceStorageDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build assembles PVC summaries for the namespace.
func (b *NamespaceStorageBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	return buildTypedTableSnapshot(ctx, scope, namespaceStorageDomainSpec(), b.available, b.maintained)
}
