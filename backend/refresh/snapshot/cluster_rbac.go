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
	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/querypage"
	"github.com/luxury-yacht/app/backend/resources/clusterrole"
	"github.com/luxury-yacht/app/backend/resources/clusterrolebinding"
)

const clusterRBACDomainName = "cluster-rbac"

// ClusterRBACBuilder produces cluster-level RBAC snapshots via the shared
// typed-table domain skeleton (typed_table_domain.go).
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

func clusterRBACDomainSpec() typedTableDomainSpec[ClusterRBACEntry] {
	return typedTableDomainSpec[ClusterRBACEntry]{
		domain:       clusterRBACDomainName,
		entryLimit:   config.SnapshotClusterRBACEntryLimit,
		description:  "cluster RBAC resources",
		adapter:      clusterRBACTableQueryAdapter(),
		schema:       clusterRBACQuerypageSchema(),
		capabilities: clusterRBACQueryCapabilities(),
		kindOf:       func(entry ClusterRBACEntry) string { return entry.Ref.Kind },
		sortRows:     sortClusterRBACEntries,
	}
}

func sortClusterRBACEntries(entries []ClusterRBACEntry) {
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Ref.Kind == entries[j].Ref.Kind {
			return entries[i].Ref.Name < entries[j].Ref.Name
		}
		return entries[i].Ref.Kind < entries[j].Ref.Kind
	})
}

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
	maintained, err := newRegisteredTypedTableStore(reg, clusterRBACDomainSpec(), clusterMeta, collectIndexer, factory, nil, ingestManager)
	if err != nil {
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

// Build constructs a snapshot of cluster RBAC resources.
func (b *ClusterRBACBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	return buildTypedTableSnapshot(ctx, scope, clusterRBACDomainSpec(), b.collectIndexer, b.maintained,
		func(meta ClusterMeta, envelope ResourceQueryEnvelope, rows []ClusterRBACEntry) any {
			return ClusterRBACSnapshot{ClusterMeta: meta, ResourceQueryEnvelope: envelope, Rows: rows}
		})
}
