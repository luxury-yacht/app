package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"k8s.io/apimachinery/pkg/labels"
	informers "k8s.io/client-go/informers"
	rbaclisters "k8s.io/client-go/listers/rbac/v1"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	"github.com/luxury-yacht/app/backend/resources/clusterrole"
	"github.com/luxury-yacht/app/backend/resources/clusterrolebinding"
)

const clusterRBACDomainName = "cluster-rbac"

// ClusterRBACPermissions indicates which resources should be included in the domain.
type ClusterRBACPermissions struct {
	IncludeClusterRoles        bool
	IncludeClusterRoleBindings bool
}

// ClusterRBACBuilder produces cluster-level RBAC snapshots.
type ClusterRBACBuilder struct {
	roleLister    rbaclisters.ClusterRoleLister
	bindingLister rbaclisters.ClusterRoleBindingLister
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
		[]string{"ClusterRole", "ClusterRoleBinding"},
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
	perms ClusterRBACPermissions,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	builder := &ClusterRBACBuilder{}
	if perms.IncludeClusterRoles {
		builder.roleLister = factory.Rbac().V1().ClusterRoles().Lister()
	}
	if perms.IncludeClusterRoleBindings {
		builder.bindingLister = factory.Rbac().V1().ClusterRoleBindings().Lister()
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
	collectors := []kindCollector[ClusterRBACEntry]{
		newClusterRoleCollector(b.roleLister),
		newClusterRoleBindingCollector(b.bindingLister),
	}
	entries, sources, version, err := collectDomainRows(ctx, clusterRBACDomainName, collectors, meta, "")
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

func newClusterRoleCollector(lister rbaclisters.ClusterRoleLister) kindCollector[ClusterRBACEntry] {
	collector := kindCollector[ClusterRBACEntry]{kind: "ClusterRole", group: "rbac.authorization.k8s.io", resource: "clusterroles", available: lister != nil}
	if lister != nil {
		collector.collect = func(meta ClusterMeta, _ string) ([]ClusterRBACEntry, uint64, error) {
			items, err := lister.List(labels.Everything())
			if err != nil {
				return nil, 0, err
			}
			rows := make([]ClusterRBACEntry, 0, len(items))
			var version uint64
			for _, role := range items {
				if role == nil {
					continue
				}
				rows = append(rows, clusterrole.BuildStreamSummary(meta, role))
				if v := resourceVersionOrTimestamp(role); v > version {
					version = v
				}
			}
			return rows, version, nil
		}
	}
	return collector
}

func newClusterRoleBindingCollector(lister rbaclisters.ClusterRoleBindingLister) kindCollector[ClusterRBACEntry] {
	collector := kindCollector[ClusterRBACEntry]{kind: "ClusterRoleBinding", group: "rbac.authorization.k8s.io", resource: "clusterrolebindings", available: lister != nil}
	if lister != nil {
		collector.collect = func(meta ClusterMeta, _ string) ([]ClusterRBACEntry, uint64, error) {
			items, err := lister.List(labels.Everything())
			if err != nil {
				return nil, 0, err
			}
			rows := make([]ClusterRBACEntry, 0, len(items))
			var version uint64
			for _, binding := range items {
				if binding == nil {
					continue
				}
				rows = append(rows, clusterrolebinding.BuildStreamSummary(meta, binding))
				if v := resourceVersionOrTimestamp(binding); v > version {
					version = v
				}
			}
			return rows, version, nil
		}
	}
	return collector
}
