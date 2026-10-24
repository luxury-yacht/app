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
	"github.com/luxury-yacht/app/backend/resources/apiextensions"
)

const clusterCRDDomainName = "cluster-crds"

// ClusterCRDBuilder constructs CustomResourceDefinition rows via the shared
// typed-table domain skeleton (typed_table_domain.go).
type ClusterCRDBuilder struct {
	available  kindAvailability
	maintained *typedMaintainedStore[ClusterCRDEntry]
}

// ClusterCRDSnapshot is returned to the frontend. It embeds the canonical
// ResourceQueryEnvelope (flattened into top-level JSON) plus the domain-typed
// rows.
type ClusterCRDSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows []ClusterCRDEntry `json:"rows"`
}

func clusterCRDQueryCapabilities() ResourceQueryCapabilities {
	return newTypedResourceCapabilities(
		[]string{"name", "kind", "group", "scope", "details", "version", "age"},
		[]string{"kinds"},
		[]string{"kind", "typeAlias", "name", "group", "scope", "details", "storageVersion"},
		[]string{apiextensions.Identity.Kind},
	)
}

// crdsQuerypageSchema derives the querypage Schema for the CRD table from its
// typed-table adapter (reusing the adapter's exact sort encoder + row key), so the
// engine orders rows byte-identically to the live executor.
func crdsQuerypageSchema() querypage.Schema[ClusterCRDEntry] {
	return querypageSchemaFromAdapter(clusterCRDTableQueryAdapter(), lowerTrimAll(clusterCRDQueryCapabilities().SortableFields))
}

// ClusterCRDEntry represents an individual CRD in the table.
//
// StorageVersion is the name of the version that the API server persists
// to etcd (the canonical "source of truth" form). ExtraServedVersionCount
// is the number of *additional* served versions beyond the storage
// version, used by the frontend to render `v1` for single-version CRDs
// and `v1 (+2)` for multi-version CRDs.
type ClusterCRDEntry = streamrows.ClusterCRDEntry

func clusterCRDDomainSpec() typedTableDomainSpec[ClusterCRDEntry] {
	return typedTableDomainSpec[ClusterCRDEntry]{
		domain:       clusterCRDDomainName,
		entryLimit:   config.SnapshotClusterCRDEntryLimit,
		description:  "CRDs",
		adapter:      clusterCRDTableQueryAdapter(),
		schema:       crdsQuerypageSchema(),
		capabilities: clusterCRDQueryCapabilities(),
		sortRows:     sortClusterCRDEntries,
		payload: func(meta ClusterMeta, envelope ResourceQueryEnvelope, rows []ClusterCRDEntry) any {
			return ClusterCRDSnapshot{ClusterMeta: meta, ResourceQueryEnvelope: envelope, Rows: rows}
		},
	}
}

func sortClusterCRDEntries(entries []ClusterCRDEntry) {
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Ref.Name < entries[j].Ref.Name
	})
}

// RegisterClusterCRDDomain registers the CRD domain. CustomResourceDefinition
// is an owned-reflector ingest kind, so its maintained store is fed from the
// ingest reflector's sink. ingestManager is nil in unit tests, where the store
// has no feed.
func RegisterClusterCRDDomain(
	reg *domain.Registry,
	clusterMeta ClusterMeta,
	ingestManager *ingest.IngestManager,
	bell doorbell.Bell,
) error {
	available := unconditionalIngestAvailability(clusterCRDDomainName, ingestManager)
	maintained, err := newRegisteredTypedTableStore(reg, clusterCRDDomainSpec(), clusterMeta, ingestManager, bell)
	if err != nil {
		return err
	}
	builder := &ClusterCRDBuilder{available: available, maintained: maintained}
	return reg.Register(refresh.DomainConfig{
		Name:          clusterCRDDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build constructs the CRD snapshot payload.
func (b *ClusterCRDBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	return buildTypedTableSnapshot(ctx, scope, clusterCRDDomainSpec(), b.available, b.maintained)
}
