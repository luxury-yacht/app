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
	"github.com/luxury-yacht/app/backend/resources/limitrange"
	"github.com/luxury-yacht/app/backend/resources/poddisruptionbudget"
	"github.com/luxury-yacht/app/backend/resources/resourcequota"
)

const (
	namespaceQuotasDomainName = "namespace-quotas"
)

// NamespaceQuotasBuilder constructs ResourceQuota/LimitRange/PodDisruptionBudget
// summaries via the shared typed-table domain skeleton (typed_table_domain.go).
type NamespaceQuotasBuilder struct {
	available kindAvailability
	// maintained, when set, is a reflector-fed store the builder serves rows from
	// instead of listing + re-projecting per request. nil falls back to the list path.
	maintained *typedMaintainedStore[QuotaSummary]
}

// quotasQuerypageSchema derives the querypage Schema for the quotas table from the
// existing typed-table adapter, via the shared generic schema builder. It REUSES the
// adapter's exact comparable sort-value encoder and row key, so the querypage engine
// orders rows byte-identically to the live typed-table executor.
func quotasQuerypageSchema() querypage.Schema[QuotaSummary] {
	return querypageSchemaFromAdapter(quotaTableQueryAdapter(), namespaceQuotasQueryCapabilities().SortableFields)
}

// NamespaceQuotasSnapshot payload for quotas tab.
type NamespaceQuotasSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows []QuotaSummary `json:"rows"`
}

func namespaceQuotasQueryCapabilities() ResourceQueryCapabilities {
	return newTypedResourceCapabilities(
		[]string{"name", "kind", "namespace", "details", "age"},
		[]string{"kinds", "namespaces"},
		[]string{"kind", "name", "namespace", "details"},
		[]string{resourcequota.Identity.Kind, limitrange.Identity.Kind, poddisruptionbudget.Identity.Kind},
	)
}

// QuotaSummary captures quota/limit range/PDB info. The type lives in the
// streamrows leaf so the kind packages can build it; these aliases keep the
// snapshot-side names and wire JSON unchanged.
type QuotaSummary = streamrows.QuotaSummary

// QuotaStatus carries PDB status fields needed by the quotas table.
type QuotaStatus = streamrows.QuotaStatus

func namespaceQuotasDomainSpec() typedTableDomainSpec[QuotaSummary] {
	return typedTableDomainSpec[QuotaSummary]{
		domain:           namespaceQuotasDomainName,
		scopeRequiredErr: "namespace scope is required",
		entryLimit:       config.SnapshotNamespaceQuotasEntryLimit,
		description:      "quota resources",
		adapter:          quotaTableQueryAdapter(),
		schema:           quotasQuerypageSchema(),
		capabilities:     namespaceQuotasQueryCapabilities(),
		sortRows:         sortQuotaSummaries,
		payload: func(meta ClusterMeta, envelope ResourceQueryEnvelope, rows []QuotaSummary) any {
			return NamespaceQuotasSnapshot{ClusterMeta: meta, ResourceQueryEnvelope: envelope, Rows: rows}
		},
	}
}

func sortQuotaSummaries(resources []QuotaSummary) {
	sort.Slice(resources, func(i, j int) bool {
		if resources[i].Ref.Namespace == resources[j].Ref.Namespace {
			return resources[i].Ref.Name < resources[j].Ref.Name
		}
		return resources[i].Ref.Namespace < resources[j].Ref.Namespace
	})
}

// RegisterNamespaceQuotasDomain registers the quotas domain. Its kinds are
// owned-reflector ingest kinds: the maintained store is fed by their ingest
// sinks (the projected QuotaSummary), and only permitted kinds serve rows.
// ingestManager is nil in unit tests, where the store has no feed.
func RegisterNamespaceQuotasDomain(
	reg *domain.Registry,
	allowed domainpermissions.AllowedResources,
	clusterMeta ClusterMeta,
	ingestManager *ingest.IngestManager,
	bell doorbell.Bell,
) error {
	available := ingestAvailability(allowed, namespaceQuotasDomainName, ingestManager)
	maintained, err := newRegisteredTypedTableStore(reg, namespaceQuotasDomainSpec(), clusterMeta,
		ingestManager, bell)
	if err != nil {
		return err
	}

	builder := &NamespaceQuotasBuilder{
		available:  available,
		maintained: maintained,
	}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceQuotasDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build assembles quota summaries for the namespace by looping the kind collectors.
func (b *NamespaceQuotasBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	return buildTypedTableSnapshot(ctx, scope, namespaceQuotasDomainSpec(), b.available, b.maintained)
}
