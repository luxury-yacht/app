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
	"github.com/luxury-yacht/app/backend/resources/role"
	"github.com/luxury-yacht/app/backend/resources/rolebinding"
	"github.com/luxury-yacht/app/backend/resources/serviceaccount"
)

const namespaceRBACDomainName = "namespace-rbac"

// NamespaceRBACBuilder constructs RBAC summaries (Role, RoleBinding,
// ServiceAccount) for a namespace via the shared typed-table domain skeleton
// (typed_table_domain.go).
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

func namespaceRBACDomainSpec() typedTableDomainSpec[RBACSummary] {
	return typedTableDomainSpec[RBACSummary]{
		domain:           namespaceRBACDomainName,
		scopeRequiredErr: "namespace scope is required",
		entryLimit:       config.SnapshotNamespaceRBACEntryLimit,
		description:      "RBAC resources",
		adapter:          rbacTableQueryAdapter(),
		schema:           rbacQuerypageSchema(),
		capabilities:     namespaceRBACQueryCapabilities(),
		kindOf:           func(resource RBACSummary) string { return resource.Kind },
		sortRows:         sortRBACSummaries,
	}
}

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
	maintained, err := newRegisteredTypedTableStore(reg, namespaceRBACDomainSpec(), clusterMeta, collectIndexer, factory, nil, ingestManager)
	if err != nil {
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

// Build assembles roles, bindings, and service accounts for the namespace by
// looping the kind collectors. An empty namespace lists all namespaces.
func (b *NamespaceRBACBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	return buildTypedTableSnapshot(ctx, scope, namespaceRBACDomainSpec(), b.collectIndexer, b.maintained,
		func(meta ClusterMeta, envelope ResourceQueryEnvelope, rows []RBACSummary) any {
			return NamespaceRBACSnapshot{ClusterMeta: meta, ResourceQueryEnvelope: envelope, Rows: rows}
		})
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
