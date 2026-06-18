package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strings"

	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
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
func RegisterNamespaceRBACDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	allowed domainpermissions.AllowedResources,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	builder := &NamespaceRBACBuilder{
		collectIndexer: sharedFactoryIndexers(factory, allowed, namespaceRBACDomainName),
	}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceRBACDomainName,
		BuildSnapshot: builder.Build,
	})
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

	resources, sources, version, err := collectDescriptorTableRows[RBACSummary](ctx, namespaceRBACDomainName, b.collectIndexer, meta, parsedScope.Namespace)
	if err != nil {
		return nil, err
	}

	sortRBACSummaries(resources)
	issues := typedTableQueryResourceIssues(ctx, namespaceRBACDomainName, query, sources)
	resolved := resolveTypedSnapshotPage(
		namespaceRBACDomainName,
		resources,
		query,
		rbacTableQueryAdapter(),
		capabilitiesWithAvailableKinds(namespaceRBACQueryCapabilities(), sources),
		config.SnapshotNamespaceRBACEntryLimit,
		"RBAC resources",
		func(resource RBACSummary) string { return resource.Kind },
		issues,
	)
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
