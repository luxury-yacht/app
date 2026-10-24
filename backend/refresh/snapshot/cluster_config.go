package snapshot

import (
	"context"
	"sort"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
	"github.com/luxury-yacht/app/backend/refresh/doorbell"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/querypage"
	"github.com/luxury-yacht/app/backend/resources/admission"
	"github.com/luxury-yacht/app/backend/resources/gatewayclass"
	"github.com/luxury-yacht/app/backend/resources/ingressclass"
	"github.com/luxury-yacht/app/backend/resources/storageclass"
)

const clusterConfigDomainName = "cluster-config"

// ClusterConfigBuilder aggregates configuration resources for the cluster tab via
// the shared typed-table domain skeleton (typed_table_domain.go).
type ClusterConfigBuilder struct {
	available kindAvailability
	// maintained, when set, is a reflector-fed store the builder serves rows from
	// instead of listing + re-projecting per request. nil falls back to the list path.
	maintained *typedMaintainedStore[ClusterConfigEntry]
}

// clusterConfigQuerypageSchema derives the querypage Schema for the cluster config
// table from the existing typed-table adapter, via the shared generic schema builder.
// It REUSES the adapter's exact comparable sort-value encoder and row key, so the
// querypage engine orders rows byte-identically to the live typed-table executor.
func clusterConfigQuerypageSchema() querypage.Schema[ClusterConfigEntry] {
	return querypageSchemaFromAdapter(clusterConfigTableQueryAdapter(), clusterConfigQueryCapabilities().SortableFields)
}

// ClusterConfigSnapshot represents the payload exposed to the UI. It embeds the
// canonical ResourceQueryEnvelope (flattened into top-level JSON) plus the
// domain-typed rows.
type ClusterConfigSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows []ClusterConfigEntry `json:"rows"`
}

func clusterConfigQueryCapabilities() ResourceQueryCapabilities {
	return newTypedResourceCapabilities(
		[]string{"name", "kind", "details", "age"},
		[]string{"kinds"},
		[]string{"kind", "name", "details"},
		[]string{storageclass.Identity.Kind, ingressclass.Identity.Kind, gatewayclass.Identity.Kind, admission.MutatingIdentity.Kind, admission.ValidatingIdentity.Kind},
	)
}

// ClusterConfigEntry covers a storage class, ingress class, or webhook config.
// The type lives in the streamrows leaf so the kind packages can build it; this
// alias keeps the snapshot-side name and wire JSON unchanged.
type ClusterConfigEntry = streamrows.ClusterConfigEntry

func clusterConfigDomainSpec() typedTableDomainSpec[ClusterConfigEntry] {
	return typedTableDomainSpec[ClusterConfigEntry]{
		domain:       clusterConfigDomainName,
		entryLimit:   config.SnapshotClusterConfigEntryLimit,
		description:  "cluster configuration resources",
		adapter:      clusterConfigTableQueryAdapter(),
		schema:       clusterConfigQuerypageSchema(),
		capabilities: clusterConfigQueryCapabilities(),
		sortRows:     sortClusterConfigEntries,
		payload: func(meta ClusterMeta, envelope ResourceQueryEnvelope, rows []ClusterConfigEntry) any {
			return ClusterConfigSnapshot{ClusterMeta: meta, ResourceQueryEnvelope: envelope, Rows: rows}
		},
	}
}

func sortClusterConfigEntries(entries []ClusterConfigEntry) {
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Ref.Kind == entries[j].Ref.Kind {
			return entries[i].Ref.Name < entries[j].Ref.Name
		}
		return entries[i].Ref.Kind < entries[j].Ref.Kind
	})
}

// RegisterClusterConfigDomain registers the cluster-config domain. Every kind
// (StorageClass, IngressClass, the admission webhooks, GatewayClass) is an
// owned-reflector ingest kind fed from its ingest Sink. When ingestManager is
// nil (a unit test) the store has no feed.
func RegisterClusterConfigDomain(
	reg *domain.Registry,
	allowed domainpermissions.AllowedResources,
	clusterMeta ClusterMeta,
	ingestManager *ingest.IngestManager,
	bell doorbell.Bell,
) error {
	available := ingestAvailability(allowed, clusterConfigDomainName, ingestManager)
	maintained, err := newRegisteredTypedTableStore(reg, clusterConfigDomainSpec(), clusterMeta,
		ingestManager, bell)
	if err != nil {
		return err
	}

	builder := &ClusterConfigBuilder{
		available:  available,
		maintained: maintained,
	}
	return reg.Register(refresh.DomainConfig{
		Name:          clusterConfigDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build produces the cluster configuration snapshot.
func (b *ClusterConfigBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	return buildTypedTableSnapshot(ctx, scope, clusterConfigDomainSpec(), b.available, b.maintained)
}
