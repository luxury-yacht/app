package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strings"

	rbacv1 "k8s.io/api/rbac/v1"
	"k8s.io/apimachinery/pkg/labels"
	informers "k8s.io/client-go/informers"
	rbaclisters "k8s.io/client-go/listers/rbac/v1"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/resourcemodel"
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

// ClusterRBACSnapshot is the payload returned to the frontend.
type ClusterRBACSnapshot struct {
	ClusterMeta
	Resources     []ClusterRBACEntry       `json:"resources"`
	Kinds         []string                 `json:"kinds,omitempty"`
	Continue      string                   `json:"continue,omitempty"`
	CursorInvalid bool                     `json:"cursorInvalid,omitempty"`
	Total         int                      `json:"total,omitempty"`
	TotalIsExact  bool                     `json:"totalIsExact"`
	Namespaces    []string                 `json:"namespaces,omitempty"`
	FacetsExact   bool                     `json:"facetsExact"`
	Dynamic       *ResourceQueryDynamicRef `json:"dynamic,omitempty"`
}

// ClusterRBACEntry represents either a ClusterRole or ClusterRoleBinding.
type ClusterRBACEntry struct {
	ClusterMeta
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Details   string `json:"details"`
	Age       string `json:"age"`
	TypeAlias string `json:"typeAlias,omitempty"`
}

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
	var roles []*rbacv1.ClusterRole
	if b.roleLister != nil && runtimeResourceAllowed(ctx, clusterRBACDomainName, "rbac.authorization.k8s.io", "clusterroles") {
		roles, err = b.roleLister.List(labels.Everything())
		if err != nil {
			return nil, fmt.Errorf("cluster rbac: failed to list clusterroles: %w", err)
		}
	}
	var bindings []*rbacv1.ClusterRoleBinding
	if b.bindingLister != nil && runtimeResourceAllowed(ctx, clusterRBACDomainName, "rbac.authorization.k8s.io", "clusterrolebindings") {
		bindings, err = b.bindingLister.List(labels.Everything())
		if err != nil {
			return nil, fmt.Errorf("cluster rbac: failed to list clusterrolebindings: %w", err)
		}
	}

	entries := make([]ClusterRBACEntry, 0, len(roles)+len(bindings))
	var version uint64

	// Delegate to the shared row builders so the full-snapshot path and
	// the streaming/incremental update path emit identical row shapes.
	// See BuildClusterRoleSummary / BuildClusterRoleBindingSummary in
	// streaming_helpers.go.
	for _, role := range roles {
		if role == nil {
			continue
		}
		entries = append(entries, BuildClusterRoleSummary(meta, role))
		if v := resourceVersionOrTimestamp(role); v > version {
			version = v
		}
	}

	for _, binding := range bindings {
		if binding == nil {
			continue
		}
		entries = append(entries, BuildClusterRoleBindingSummary(meta, binding))
		if v := resourceVersionOrTimestamp(binding); v > version {
			version = v
		}
	}

	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Kind == entries[j].Kind {
			return entries[i].Name < entries[j].Name
		}
		return entries[i].Kind < entries[j].Kind
	})

	if query.Enabled {
		page := applyTypedTableQuery(entries, query, clusterRBACTableQueryAdapter())
		return &refresh.Snapshot{
			Domain:  clusterRBACDomainName,
			Scope:   refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed)),
			Version: version,
			Payload: ClusterRBACSnapshot{
				ClusterMeta:   meta,
				Resources:     page.Rows,
				Kinds:         page.Kinds,
				Continue:      page.Continue,
				CursorInvalid: page.CursorInvalid,
				Total:         page.Total,
				TotalIsExact:  page.TotalIsExact,
				Namespaces:    page.Namespaces,
				FacetsExact:   page.FacetsExact,
				Dynamic:       page.Dynamic,
			},
			Stats: refresh.SnapshotStats{ItemCount: len(page.Rows)},
		}, nil
	}

	var totalItems int
	entries, totalItems = truncateSnapshotWindow(entries, config.SnapshotClusterRBACEntryLimit)

	return &refresh.Snapshot{
		Domain:  clusterRBACDomainName,
		Version: version,
		Payload: ClusterRBACSnapshot{
			ClusterMeta:  meta,
			Resources:    entries,
			Kinds:        snapshotSortedKinds(entries, func(entry ClusterRBACEntry) string { return entry.Kind }),
			Total:        totalItems,
			TotalIsExact: totalItems == len(entries),
		},
		Stats: snapshotWindowStats(len(entries), totalItems, "cluster RBAC resources"),
	}, nil
}

func describeClusterRoleFacts(facts *resourcemodel.ClusterRoleFacts) string {
	if facts == nil {
		return ""
	}
	details := fmt.Sprintf("Rules: %d", len(facts.Rules))
	if facts.AggregationRule != nil {
		details += " (aggregated)"
	}
	return details
}

func describeClusterRoleBindingFacts(facts *resourcemodel.ClusterRoleBindingFacts) string {
	if facts == nil {
		return ""
	}
	role := resourceLinkName(facts.RoleRef)
	if role == "" {
		role = "-"
	}
	return fmt.Sprintf("Role: %s, Subjects: %d", role, len(facts.Subjects))
}
