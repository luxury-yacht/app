package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strings"

	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	"k8s.io/apimachinery/pkg/labels"
	informers "k8s.io/client-go/informers"
	corelisters "k8s.io/client-go/listers/core/v1"
	rbaclisters "k8s.io/client-go/listers/rbac/v1"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
)

const namespaceRBACDomainName = "namespace-rbac"

// NamespaceRBACPermissions indicates which resources should be included in the domain.
type NamespaceRBACPermissions struct {
	IncludeRoles           bool
	IncludeRoleBindings    bool
	IncludeServiceAccounts bool
}

// NamespaceRBACBuilder constructs RBAC summaries for a namespace.
type NamespaceRBACBuilder struct {
	roleLister    rbaclisters.RoleLister
	bindingLister rbaclisters.RoleBindingLister
	saLister      corelisters.ServiceAccountLister
}

// NamespaceRBACSnapshot payload for RBAC view.
type NamespaceRBACSnapshot struct {
	ClusterMeta
	Resources []RBACSummary `json:"resources"`
}

// RBACSummary describes a Role/RoleBinding/ServiceAccount entry.
type RBACSummary struct {
	ClusterMeta
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Details   string `json:"details"`
	Age       string `json:"age"`
}

// RegisterNamespaceRBACDomain registers the namespace RBAC domain.
// Only listers for permitted resources are wired; denied resources are left nil
// so the builder skips them gracefully.
func RegisterNamespaceRBACDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	perms NamespaceRBACPermissions,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	builder := &NamespaceRBACBuilder{}
	if perms.IncludeRoles {
		builder.roleLister = factory.Rbac().V1().Roles().Lister()
	}
	if perms.IncludeRoleBindings {
		builder.bindingLister = factory.Rbac().V1().RoleBindings().Lister()
	}
	if perms.IncludeServiceAccounts {
		builder.saLister = factory.Core().V1().ServiceAccounts().Lister()
	}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceRBACDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build assembles roles, bindings, and service accounts for the namespace.
func (b *NamespaceRBACBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	_ = ctx
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	trimmed = strings.TrimSpace(trimmed)
	if trimmed == "" {
		return nil, fmt.Errorf("namespace scope is required")
	}

	isAll := isAllNamespaceScope(trimmed)
	var namespace string
	if !isAll {
		namespace = normalizeNamespaceScope(trimmed)
		if namespace == "" {
			return nil, fmt.Errorf("namespace scope is required")
		}
	}

	var (
		roles           []*rbacv1.Role
		bindings        []*rbacv1.RoleBinding
		serviceAccounts []*corev1.ServiceAccount
		err             error
	)

	if isAll {
		if b.roleLister != nil {
			roles, err = b.roleLister.List(labels.Everything())
			if err != nil {
				return nil, err
			}
		}
		if b.bindingLister != nil {
			bindings, err = b.bindingLister.List(labels.Everything())
			if err != nil {
				return nil, err
			}
		}
		if b.saLister != nil {
			serviceAccounts, err = b.saLister.List(labels.Everything())
			if err != nil {
				return nil, err
			}
		}
	} else {
		if b.roleLister != nil {
			roles, err = b.roleLister.Roles(namespace).List(labels.Everything())
			if err != nil {
				return nil, err
			}
		}
		if b.bindingLister != nil {
			bindings, err = b.bindingLister.RoleBindings(namespace).List(labels.Everything())
			if err != nil {
				return nil, err
			}
		}
		if b.saLister != nil {
			serviceAccounts, err = b.saLister.ServiceAccounts(namespace).List(labels.Everything())
			if err != nil {
				return nil, err
			}
		}
	}

	return buildNamespaceRBACSnapshot(meta, clusterID, isAll, namespace, roles, bindings, serviceAccounts)
}

func buildNamespaceRBACSnapshot(
	meta ClusterMeta,
	clusterID string,
	isAll bool,
	namespace string,
	roles []*rbacv1.Role,
	bindings []*rbacv1.RoleBinding,
	serviceAccounts []*corev1.ServiceAccount,
) (*refresh.Snapshot, error) {
	resources := make([]RBACSummary, 0, len(roles)+len(bindings)+len(serviceAccounts))
	var version uint64

	for _, role := range roles {
		if role == nil {
			continue
		}
		summary := RBACSummary{
			ClusterMeta: meta,
			Kind:      "Role",
			Name:      role.Name,
			Namespace: role.Namespace,
			Details:   describeRole(role),
			Age:       formatAge(role.CreationTimestamp.Time),
		}
		resources = append(resources, summary)
		if v := resourceVersionOrTimestamp(role); v > version {
			version = v
		}
	}

	for _, binding := range bindings {
		if binding == nil {
			continue
		}
		summary := RBACSummary{
			ClusterMeta: meta,
			Kind:      "RoleBinding",
			Name:      binding.Name,
			Namespace: binding.Namespace,
			Details:   describeRoleBinding(binding),
			Age:       formatAge(binding.CreationTimestamp.Time),
		}
		resources = append(resources, summary)
		if v := resourceVersionOrTimestamp(binding); v > version {
			version = v
		}
	}

	for _, sa := range serviceAccounts {
		if sa == nil {
			continue
		}
		summary := RBACSummary{
			ClusterMeta: meta,
			Kind:      "ServiceAccount",
			Name:      sa.Name,
			Namespace: sa.Namespace,
			Details:   describeServiceAccount(sa),
			Age:       formatAge(sa.CreationTimestamp.Time),
		}
		resources = append(resources, summary)
		if v := resourceVersionOrTimestamp(sa); v > version {
			version = v
		}
	}

	sortRBACSummaries(resources)

	scope := namespace
	if isAll {
		scope = "namespace:all"
	}
	scope = refresh.JoinClusterScope(clusterID, scope)

	return &refresh.Snapshot{
		Domain:  namespaceRBACDomainName,
		Scope:   scope,
		Version: version,
		Payload: NamespaceRBACSnapshot{ClusterMeta: meta, Resources: resources},
		Stats: refresh.SnapshotStats{
			ItemCount: len(resources),
		},
	}, nil
}

func describeRole(role *rbacv1.Role) string {
	if role == nil {
		return ""
	}
	return fmt.Sprintf("Rules: %d", len(role.Rules))
}

func describeRoleBinding(binding *rbacv1.RoleBinding) string {
	if binding == nil {
		return ""
	}
	role := binding.RoleRef.Name
	if role == "" {
		role = "-"
	}
	return fmt.Sprintf("Role: %s, Subjects: %d", role, len(binding.Subjects))
}

func describeServiceAccount(sa *corev1.ServiceAccount) string {
	if sa == nil {
		return ""
	}
	return fmt.Sprintf("Secrets: %d", len(sa.Secrets))
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
