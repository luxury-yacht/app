package snapshot

import (
	"context"
	"fmt"
	"sort"

	rbacv1 "k8s.io/api/rbac/v1"
	"k8s.io/apimachinery/pkg/labels"
	informers "k8s.io/client-go/informers"
	rbaclisters "k8s.io/client-go/listers/rbac/v1"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
)

const clusterRBACDomainName = "cluster-rbac"

// ClusterRBACBuilder produces cluster-level RBAC snapshots.
type ClusterRBACBuilder struct {
	roleLister    rbaclisters.ClusterRoleLister
	bindingLister rbaclisters.ClusterRoleBindingLister
}

// ClusterRBACSnapshot is the payload returned to the frontend.
type ClusterRBACSnapshot struct {
	ClusterMeta
	Resources []ClusterRBACEntry `json:"resources"`
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
func RegisterClusterRBACDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	builder := &ClusterRBACBuilder{
		roleLister:    factory.Rbac().V1().ClusterRoles().Lister(),
		bindingLister: factory.Rbac().V1().ClusterRoleBindings().Lister(),
	}
	return reg.Register(refresh.DomainConfig{
		Name:          clusterRBACDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build constructs a snapshot of cluster RBAC resources.
func (b *ClusterRBACBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	if b.roleLister == nil || b.bindingLister == nil {
		return nil, fmt.Errorf("cluster rbac: listers not configured")
	}

	meta := ClusterMetaFromContext(ctx)
	roles, err := b.roleLister.List(labels.Everything())
	if err != nil {
		return nil, fmt.Errorf("cluster rbac: failed to list clusterroles: %w", err)
	}
	bindings, err := b.bindingLister.List(labels.Everything())
	if err != nil {
		return nil, fmt.Errorf("cluster rbac: failed to list clusterrolebindings: %w", err)
	}

	entries := make([]ClusterRBACEntry, 0, len(roles)+len(bindings))
	var version uint64

	for _, role := range roles {
		if role == nil {
			continue
		}
		entry := ClusterRBACEntry{
			ClusterMeta: meta,
			Kind:      "ClusterRole",
			Name:      role.Name,
			Details:   describeClusterRole(role),
			Age:       formatAge(role.CreationTimestamp.Time),
			TypeAlias: "CR",
		}
		entries = append(entries, entry)
		if v := resourceVersionOrTimestamp(role); v > version {
			version = v
		}
	}

	for _, binding := range bindings {
		if binding == nil {
			continue
		}
		entry := ClusterRBACEntry{
			ClusterMeta: meta,
			Kind:      "ClusterRoleBinding",
			Name:      binding.Name,
			Details:   describeClusterRoleBinding(binding),
			Age:       formatAge(binding.CreationTimestamp.Time),
			TypeAlias: "CRB",
		}
		entries = append(entries, entry)
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

	return &refresh.Snapshot{
		Domain:  clusterRBACDomainName,
		Version: version,
		Payload: ClusterRBACSnapshot{ClusterMeta: meta, Resources: entries},
		Stats:   refresh.SnapshotStats{ItemCount: len(entries)},
	}, nil
}

func describeClusterRole(role *rbacv1.ClusterRole) string {
	if role == nil {
		return ""
	}
	details := fmt.Sprintf("Rules: %d", len(role.Rules))
	if role.AggregationRule != nil {
		details += " (aggregated)"
	}
	return details
}

func describeClusterRoleBinding(binding *rbacv1.ClusterRoleBinding) string {
	if binding == nil {
		return ""
	}
	role := binding.RoleRef.Name
	if role == "" {
		role = "-"
	}
	return fmt.Sprintf("Role: %s, Subjects: %d", role, len(binding.Subjects))
}
