package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strings"

	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/streamspec"
	"github.com/luxury-yacht/app/backend/resources/clusterrole"
	"github.com/luxury-yacht/app/backend/resources/clusterrolebinding"
)

const clusterRBACDomainName = "cluster-rbac"

// ClusterRBACBuilder produces cluster-level RBAC snapshots by listing each
// registered kind from its informer indexer.
type ClusterRBACBuilder struct {
	collectIndexer func(streamspec.Descriptor) cache.Indexer
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
func RegisterClusterRBACDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	allowed domainpermissions.AllowedResources,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	builder := &ClusterRBACBuilder{
		collectIndexer: sharedFactoryIndexers(factory, allowed, clusterRBACDomainName),
	}
	return reg.Register(refresh.DomainConfig{
		Name:          clusterRBACDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build constructs a snapshot of cluster RBAC resources.
func (b *ClusterRBACBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	_, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(trimmed), clusterRBACDomainName, "")
	if err != nil {
		return nil, err
	}
	entries, sources, version, err := collectDescriptorTableRows[ClusterRBACEntry](ctx, clusterRBACDomainName, b.collectIndexer, meta, "")
	if err != nil {
		return nil, err
	}

	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Kind == entries[j].Kind {
			return entries[i].Name < entries[j].Name
		}
		return entries[i].Kind < entries[j].Kind
	})
	issues := typedTableQueryResourceIssues(ctx, clusterRBACDomainName, query, sources)

	resolved := resolveTypedSnapshotPage(
		clusterRBACDomainName,
		entries,
		query,
		clusterRBACTableQueryAdapter(),
		capabilitiesWithAvailableKinds(clusterRBACQueryCapabilities(), sources),
		config.SnapshotClusterRBACEntryLimit,
		"cluster RBAC resources",
		func(entry ClusterRBACEntry) string { return entry.Kind },
		issues,
	)
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
