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
	"github.com/luxury-yacht/app/backend/resources/role"
	"github.com/luxury-yacht/app/backend/resources/rolebinding"
	"github.com/luxury-yacht/app/backend/resources/serviceaccount"
)

const namespaceRBACDomainName = "namespace-rbac"

// NamespaceRBACBuilder constructs RBAC summaries for a namespace by listing each
// registered kind from its informer indexer; collectIndexer resolves a stream
// descriptor to its permitted indexer (nil when the kind is unavailable).
type NamespaceRBACBuilder struct {
	collectIndexer func(streamspec.Descriptor) cache.Indexer
	// maintained, when set, is an informer-fed store the builder serves rows from
	// instead of listing + re-projecting per request. nil falls back to the list path.
	maintained *typedMaintainedStore[RBACSummary]
}

// rbacQuerypageSchema derives the querypage Schema for the RBAC table from the
// existing typed-table adapter, via the shared generic schema builder. It REUSES the
// adapter's exact comparable sort-value encoder and row key, so the querypage engine
// orders rows byte-identically to the live typed-table executor.
func rbacQuerypageSchema() querypage.Schema[RBACSummary] {
	return querypageSchemaFromAdapter(rbacTableQueryAdapter(), []string{"name", "kind", "namespace", "details", "age"})
}

// NamespaceRBACSnapshot payload for RBAC view.
type NamespaceRBACSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows []RBACSummary `json:"rows"`
}

func namespaceRBACQueryCapabilities() ResourceQueryCapabilities {
	return newTypedResourceCapabilities(
		[]string{"name", "kind", "namespace", "details", "age"},
		[]string{"kinds", "namespaces"},
		[]string{"kind", "name", "namespace", "details"},
		[]string{role.Identity.Kind, rolebinding.Identity.Kind, serviceaccount.Identity.Kind},
	)
}

// RBACSummary describes a Role/RoleBinding/ServiceAccount entry. The type lives in
// the streamrows leaf so the kind packages can build it; this alias keeps the
// snapshot-side name and wire JSON unchanged.
type RBACSummary = streamrows.RBACSummary

// RegisterNamespaceRBACDomain registers the namespace RBAC domain. The kinds it
// serves, their informers, and their row builders all come from the shared stream
// descriptor registry; only informers for permitted resources are registered, so
// denied resources are skipped gracefully.
//
// Role, RoleBinding, and ServiceAccount are owned-reflector ingest kinds (IngestOwned):
// when ingestManager is non-nil their maintained-store feed comes from the ingest
// reflectors' Table-half Sink and registerMaintainedHandlers skips them (the shared
// factory no longer caches them). When ingestManager is nil (a unit test) the store has
// no feed for the cut kinds.
func RegisterNamespaceRBACDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	allowed domainpermissions.AllowedResources,
	clusterMeta ClusterMeta,
	ingestManager *ingest.IngestManager,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	collectIndexer := sharedFactoryIndexers(factory, allowed, namespaceRBACDomainName, ingestManager)

	// Maintain a per-cluster store fed by each available RBAC kind's source: the
	// ingest Sink for cut kinds, the shared-informer handler for any uncut kind.
	maintained := newTypedMaintainedStore(clusterMeta, rbacQuerypageSchema(), rbacTableQueryAdapter())
	reg.RegisterMaintainedStore(namespaceRBACDomainName, maintained) // spill/restore/reconcile across Cold/re-warm
	feedMaintainedFromIngest(maintained, namespaceRBACDomainName, ingestManager)
	if err := registerMaintainedHandlers(maintained, namespaceRBACDomainName, collectIndexer, factory, nil); err != nil {
		return err
	}

	builder := &NamespaceRBACBuilder{
		collectIndexer: collectIndexer,
		maintained:     maintained,
	}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceRBACDomainName,
		BuildSnapshot: builder.Build,
	})
}

// rbacSources computes per-descriptor availability for THIS request (indexer present
// AND runtimeResourceAllowed), returning the snapshot sources and a Kind→available
// map — the same gating collectDescriptorTableRows applies, so the maintained-store
// path and the list path agree on which kinds are visible.
func (b *NamespaceRBACBuilder) rbacSources(ctx context.Context) ([]typedTableResourceSource, map[string]bool) {
	descriptors := kindregistry.StreamDescriptorsForDomain(namespaceRBACDomainName)
	sources := make([]typedTableResourceSource, 0, len(descriptors))
	available := make(map[string]bool, len(descriptors))
	for _, d := range descriptors {
		ok := b.collectIndexer(d) != nil && runtimeResourceAllowed(ctx, namespaceRBACDomainName, d.Group, d.Resource)
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

// Build assembles roles, bindings, and service accounts for the namespace by
// looping the kind collectors. An empty namespace lists all namespaces.
func (b *NamespaceRBACBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	baseScope, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(trimmed), namespaceRBACDomainName, "")
	if err != nil {
		return nil, err
	}
	parsedScope, err := parseNamespaceSnapshotScope(refresh.JoinClusterScope(clusterID, baseScope), "namespace scope is required")
	if err != nil {
		return nil, err
	}

	var resolved typedSnapshotPage[RBACSummary]
	var version uint64
	if b.maintained != nil {
		// Serve the query straight from the informer-fed store, querying it in place
		// (O(log N + page)) rather than snapshotting + rebuilding a per-Build store.
		sources, available := b.rbacSources(ctx)
		resolved = resolveMaintainedDirect(
			b.maintained.store,
			query,
			available,
			parsedScope.Namespace,
			rbacTableQueryAdapter(),
			rbacQuerypageSchema(),
			capabilitiesWithAvailableKinds(namespaceRBACQueryCapabilities(), sources),
			config.SnapshotNamespaceRBACEntryLimit,
			"RBAC resources",
			func(resource RBACSummary) string { return resource.Kind },
			func() []RBACSummary {
				rows := b.maintained.rows(parsedScope.Namespace, available)
				sortRBACSummaries(rows)
				return rows
			},
			typedTableQueryResourceIssues(ctx, namespaceRBACDomainName, query, sources),
		)
		version = b.maintained.snapshotVersion()
	} else {
		resources, sources, v, err := collectDescriptorTableRows[RBACSummary](ctx, namespaceRBACDomainName, b.collectIndexer, meta, parsedScope.Namespace)
		if err != nil {
			return nil, err
		}
		version = v
		sortRBACSummaries(resources)
		resolved = resolveTypedSnapshotPageViaStore(
			namespaceRBACDomainName,
			resources,
			query,
			rbacTableQueryAdapter(),
			rbacQuerypageSchema(),
			capabilitiesWithAvailableKinds(namespaceRBACQueryCapabilities(), sources),
			config.SnapshotNamespaceRBACEntryLimit,
			"RBAC resources",
			func(resource RBACSummary) string { return resource.Kind },
			typedTableQueryResourceIssues(ctx, namespaceRBACDomainName, query, sources),
		)
	}
	return &refresh.Snapshot{
		Domain:  namespaceRBACDomainName,
		Scope:   refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed)),
		Version: version,
		Payload: NamespaceRBACSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: resolved.Envelope,
			Rows:                  resolved.Rows,
		},
		Stats: resolved.Stats,
	}, nil
}

func sortRBACSummaries(resources []RBACSummary) {
	sort.SliceStable(resources, func(i, j int) bool {
		if resources[i].Namespace != resources[j].Namespace {
			return resources[i].Namespace < resources[j].Namespace
		}
		if resources[i].Kind != resources[j].Kind {
			return resources[i].Kind < resources[j].Kind
		}
		return resources[i].Name < resources[j].Name
	})
}
