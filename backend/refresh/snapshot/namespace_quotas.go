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
	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
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
// summaries by listing each registered kind from its informer indexer.
type NamespaceQuotasBuilder struct {
	collectIndexer func(streamspec.Descriptor) cache.Indexer
	// maintained, when set, is an informer-fed store the builder serves rows from
	// instead of listing + re-projecting per request. nil falls back to the list path.
	maintained *typedMaintainedStore[QuotaSummary]
}

// quotasQuerypageSchema derives the querypage Schema for the quotas table from the
// existing typed-table adapter, via the shared generic schema builder. It REUSES the
// adapter's exact comparable sort-value encoder and row key, so the querypage engine
// orders rows byte-identically to the live typed-table executor.
func quotasQuerypageSchema() querypage.Schema[QuotaSummary] {
	return querypageSchemaFromAdapter(quotaTableQueryAdapter(), []string{"name", "kind", "namespace", "details", "age"})
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

// RegisterNamespaceQuotasDomain registers quotas domain.
// Only listers for permitted resources are wired; denied resources are left nil
// so the builder skips them gracefully.
//
// When ingestManager is non-nil the quotas kinds are owned-reflector ingest kinds:
// the maintained store is fed by the ingest reflectors' Table-half Sink (the
// projected QuotaSummary) instead of typed-informer event handlers, so the shared
// factory no longer caches them. When it is nil (e.g. uncut, or a unit test) the
// store falls back to informer handlers.
func RegisterNamespaceQuotasDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	allowed domainpermissions.AllowedResources,
	clusterMeta ClusterMeta,
	ingestManager *ingest.IngestManager,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	collectIndexer := sharedFactoryIndexers(factory, allowed, namespaceQuotasDomainName, ingestManager)

	// Maintain a per-cluster store fed by each available quota kind's source. Every
	// quota kind is ingest-owned, so the ingest Sink feeds them all and
	// registerMaintainedHandlers (which skips ingest-owned kinds) registers nothing —
	// but it stays so a nil-ingest unit test still has a defined (empty) feed path.
	maintained := newTypedMaintainedStore(clusterMeta, quotasQuerypageSchema(), quotaTableQueryAdapter())
	reg.RegisterMaintainedStore(namespaceQuotasDomainName, maintained) // spill/restore/reconcile across Cold/re-warm
	feedMaintainedFromIngest(maintained, namespaceQuotasDomainName, ingestManager)
	if err := registerMaintainedHandlers(maintained, namespaceQuotasDomainName, collectIndexer, factory, nil); err != nil {
		return err
	}

	builder := &NamespaceQuotasBuilder{
		collectIndexer: collectIndexer,
		maintained:     maintained,
	}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceQuotasDomainName,
		BuildSnapshot: builder.Build,
	})
}

// quotasSources computes per-descriptor availability for THIS request (indexer
// present AND runtimeResourceAllowed), returning the snapshot sources and a
// Kind→available map — the same gating collectDescriptorTableRows applies, so the
// maintained-store path and the list path agree on which kinds are visible.
func (b *NamespaceQuotasBuilder) quotasSources(ctx context.Context) ([]typedTableResourceSource, map[string]bool) {
	descriptors := kindregistry.StreamDescriptorsForDomain(namespaceQuotasDomainName)
	sources := make([]typedTableResourceSource, 0, len(descriptors))
	available := make(map[string]bool, len(descriptors))
	for _, d := range descriptors {
		ok := b.collectIndexer(d) != nil && runtimeResourceAllowed(ctx, namespaceQuotasDomainName, d.Group, d.Resource)
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

// Build assembles quota summaries for the namespace by looping the kind collectors.
func (b *NamespaceQuotasBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	baseScope, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(trimmed), namespaceQuotasDomainName, "")
	if err != nil {
		return nil, err
	}
	parsedScope, err := parseNamespaceSnapshotScope(refresh.JoinClusterScope(clusterID, baseScope), "namespace scope is required")
	if err != nil {
		return nil, err
	}

	sortQuotaSummaries := func(resources []QuotaSummary) {
		sort.Slice(resources, func(i, j int) bool {
			if resources[i].Namespace == resources[j].Namespace {
				return resources[i].Name < resources[j].Name
			}
			return resources[i].Namespace < resources[j].Namespace
		})
	}

	var resolved typedSnapshotPage[QuotaSummary]
	var version uint64
	if b.maintained != nil {
		// Serve the query straight from the informer-fed store, querying it in place
		// (O(log N + page)) rather than snapshotting + rebuilding a per-Build store.
		sources, available := b.quotasSources(ctx)
		resolved = resolveMaintainedDirect(
			b.maintained.store,
			query,
			available,
			parsedScope.Namespace,
			quotaTableQueryAdapter(),
			quotasQuerypageSchema(),
			capabilitiesWithAvailableKinds(namespaceQuotasQueryCapabilities(), sources),
			config.SnapshotNamespaceQuotasEntryLimit,
			"quota resources",
			func(resource QuotaSummary) string { return resource.Kind },
			func() []QuotaSummary {
				rows := b.maintained.rows(parsedScope.Namespace, available)
				sortQuotaSummaries(rows)
				return rows
			},
			typedTableQueryResourceIssues(ctx, namespaceQuotasDomainName, query, sources),
		)
		version = b.maintained.snapshotVersion()
	} else {
		resources, sources, v, err := collectDescriptorTableRows[QuotaSummary](ctx, namespaceQuotasDomainName, b.collectIndexer, meta, parsedScope.Namespace)
		if err != nil {
			return nil, err
		}
		version = v
		sortQuotaSummaries(resources)
		resolved = resolveTypedSnapshotPageViaStore(
			namespaceQuotasDomainName,
			resources,
			query,
			quotaTableQueryAdapter(),
			quotasQuerypageSchema(),
			capabilitiesWithAvailableKinds(namespaceQuotasQueryCapabilities(), sources),
			config.SnapshotNamespaceQuotasEntryLimit,
			"quota resources",
			func(resource QuotaSummary) string { return resource.Kind },
			typedTableQueryResourceIssues(ctx, namespaceQuotasDomainName, query, sources),
		)
	}
	return &refresh.Snapshot{
		Domain:  namespaceQuotasDomainName,
		Scope:   refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed)),
		Version: version,
		Payload: NamespaceQuotasSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: resolved.Envelope,
			Rows:                  resolved.Rows,
		},
		Stats: resolved.Stats,
	}, nil
}
