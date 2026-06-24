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
	"github.com/luxury-yacht/app/backend/resources/clusterrole"
	"github.com/luxury-yacht/app/backend/resources/clusterrolebinding"
)

const clusterRBACDomainName = "cluster-rbac"

// ClusterRBACBuilder produces cluster-level RBAC snapshots by listing each
// registered kind from its informer indexer.
type ClusterRBACBuilder struct {
	collectIndexer func(streamspec.Descriptor) cache.Indexer
	// maintained, when set, is an informer-fed store the builder serves rows from
	// instead of listing + re-projecting per request. nil falls back to the list path.
	maintained *typedMaintainedStore[ClusterRBACEntry]
}

// clusterRBACQuerypageSchema derives the querypage Schema for the cluster RBAC table
// from the existing typed-table adapter, via the shared generic schema builder. It
// REUSES the adapter's exact comparable sort-value encoder and row key, so the
// querypage engine orders rows byte-identically to the live typed-table executor.
func clusterRBACQuerypageSchema() querypage.Schema[ClusterRBACEntry] {
	return querypageSchemaFromAdapter(clusterRBACTableQueryAdapter(), []string{"name", "kind", "details", "age"})
}

// ClusterRBACSnapshot is the payload returned to the frontend. It embeds the
// canonical ResourceQueryEnvelope (flattened into top-level JSON) plus the
// domain-typed rows.
type ClusterRBACSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows []ClusterRBACEntry `json:"rows"`
}

func clusterRBACQueryCapabilities() ResourceQueryCapabilities {
	return newTypedResourceCapabilities(
		[]string{"name", "kind", "details", "age"},
		[]string{"kinds"},
		[]string{"kind", "typeAlias", "name", "details"},
		[]string{clusterrole.Identity.Kind, clusterrolebinding.Identity.Kind},
	)
}

// ClusterRBACEntry represents either a ClusterRole or ClusterRoleBinding. The type
// lives in the streamrows leaf so the kind packages can build it; this alias keeps
// the snapshot-side name and wire JSON unchanged.
type ClusterRBACEntry = streamrows.ClusterRBACEntry

// RegisterClusterRBACDomain wires the cluster RBAC domain into the registry.
// Only listers for permitted resources are wired; denied resources are left nil
// so the builder skips them gracefully.
//
// ClusterRole and ClusterRoleBinding are owned-reflector ingest kinds (IngestOwned):
// when ingestManager is non-nil their maintained-store feed comes from the ingest
// reflectors' Table-half Sink and registerMaintainedHandlers skips them (the shared
// factory no longer caches them). When ingestManager is nil (a unit test) the store has
// no feed for the cut kinds.
func RegisterClusterRBACDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	allowed domainpermissions.AllowedResources,
	clusterMeta ClusterMeta,
	ingestManager *ingest.IngestManager,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	collectIndexer := sharedFactoryIndexers(factory, allowed, clusterRBACDomainName, ingestManager)

	// Maintain a per-cluster store fed by each available RBAC kind's source: the
	// ingest Sink for cut kinds, the shared-informer handler for any uncut kind.
	maintained := newTypedMaintainedStore(clusterMeta, clusterRBACQuerypageSchema(), clusterRBACTableQueryAdapter())
	reg.RegisterMaintainedStore(clusterRBACDomainName, maintained) // spill/restore/reconcile across Cold/re-warm
	feedMaintainedFromIngest(maintained, clusterRBACDomainName, ingestManager)
	if err := registerMaintainedHandlers(maintained, clusterRBACDomainName, collectIndexer, factory, nil); err != nil {
		return err
	}

	builder := &ClusterRBACBuilder{
		collectIndexer: collectIndexer,
		maintained:     maintained,
	}
	return reg.Register(refresh.DomainConfig{
		Name:          clusterRBACDomainName,
		BuildSnapshot: builder.Build,
	})
}

// clusterRBACSources computes per-descriptor availability for THIS request (indexer
// present AND runtimeResourceAllowed), returning the snapshot sources and a
// Kind→available map — the same gating collectDescriptorTableRows applies, so the
// maintained-store path and the list path agree on which kinds are visible.
func (b *ClusterRBACBuilder) clusterRBACSources(ctx context.Context) ([]typedTableResourceSource, map[string]bool) {
	descriptors := kindregistry.StreamDescriptorsForDomain(clusterRBACDomainName)
	sources := make([]typedTableResourceSource, 0, len(descriptors))
	available := make(map[string]bool, len(descriptors))
	for _, d := range descriptors {
		ok := b.collectIndexer(d) != nil && runtimeResourceAllowed(ctx, clusterRBACDomainName, d.Group, d.Resource)
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

// Build constructs a snapshot of cluster RBAC resources.
func (b *ClusterRBACBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	_, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(trimmed), clusterRBACDomainName, "")
	if err != nil {
		return nil, err
	}
	sortClusterRBACEntries := func(entries []ClusterRBACEntry) {
		sort.Slice(entries, func(i, j int) bool {
			if entries[i].Kind == entries[j].Kind {
				return entries[i].Name < entries[j].Name
			}
			return entries[i].Kind < entries[j].Kind
		})
	}

	var resolved typedSnapshotPage[ClusterRBACEntry]
	var version uint64
	if b.maintained != nil {
		// Serve the query straight from the informer-fed store, querying it in place
		// (O(log N + page)) rather than snapshotting + rebuilding a per-Build store. The
		// domain is cluster-scoped, so the store is queried for all rows ("").
		sources, available := b.clusterRBACSources(ctx)
		resolved = resolveMaintainedDirect(
			b.maintained.store,
			query,
			available,
			"",
			clusterRBACTableQueryAdapter(),
			clusterRBACQuerypageSchema(),
			capabilitiesWithAvailableKinds(clusterRBACQueryCapabilities(), sources),
			config.SnapshotClusterRBACEntryLimit,
			"cluster RBAC resources",
			func(entry ClusterRBACEntry) string { return entry.Kind },
			func() []ClusterRBACEntry {
				rows := b.maintained.rows("", available)
				sortClusterRBACEntries(rows)
				return rows
			},
			typedTableQueryResourceIssues(ctx, clusterRBACDomainName, query, sources),
		)
		version = b.maintained.snapshotVersion()
	} else {
		entries, sources, v, listErr := collectDescriptorTableRows[ClusterRBACEntry](ctx, clusterRBACDomainName, b.collectIndexer, meta, "")
		if listErr != nil {
			return nil, listErr
		}
		version = v
		sortClusterRBACEntries(entries)
		resolved = resolveTypedSnapshotPageViaStore(
			clusterRBACDomainName,
			entries,
			query,
			clusterRBACTableQueryAdapter(),
			clusterRBACQuerypageSchema(),
			capabilitiesWithAvailableKinds(clusterRBACQueryCapabilities(), sources),
			config.SnapshotClusterRBACEntryLimit,
			"cluster RBAC resources",
			func(entry ClusterRBACEntry) string { return entry.Kind },
			typedTableQueryResourceIssues(ctx, clusterRBACDomainName, query, sources),
		)
	}
	// The window snapshot is the canonical unscoped refresh payload; only the
	// query page publishes the request scope.
	snapshotScope := ""
	if query.Enabled {
		snapshotScope = refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed))
	}
	return &refresh.Snapshot{
		Domain:  clusterRBACDomainName,
		Scope:   snapshotScope,
		Version: version,
		Payload: ClusterRBACSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: resolved.Envelope,
			Rows:                  resolved.Rows,
		},
		Stats: resolved.Stats,
	}, nil
}
