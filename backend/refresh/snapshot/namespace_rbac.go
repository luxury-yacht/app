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

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	rolepkg "github.com/luxury-yacht/app/backend/resources/role"
	"github.com/luxury-yacht/app/backend/resources/rolebinding"
	"github.com/luxury-yacht/app/backend/resources/serviceaccount"
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
	ResourceQueryEnvelope
	Rows []RBACSummary `json:"rows"`
}

func namespaceRBACQueryCapabilities() ResourceQueryCapabilities {
	return newTypedResourceCapabilities(
		[]string{"name", "kind", "namespace", "details", "age"},
		[]string{"kinds", "namespaces"},
		[]string{"kind", "name", "namespace", "details"},
		[]string{"Role", "RoleBinding", "ServiceAccount"},
	)
}

// RBACSummary describes a Role/RoleBinding/ServiceAccount entry. The type lives in
// the streamrows leaf so the kind packages can build it; this alias keeps the
// snapshot-side name and wire JSON unchanged.
type RBACSummary = streamrows.RBACSummary

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

	collectors := []kindCollector[RBACSummary]{
		newRoleCollector(b.roleLister),
		newRoleBindingCollector(b.bindingLister),
		newServiceAccountCollector(b.saLister),
	}
	resources, sources, version, err := collectDomainRows(ctx, namespaceRBACDomainName, collectors, meta, parsedScope.Namespace)
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

func newRoleCollector(lister rbaclisters.RoleLister) kindCollector[RBACSummary] {
	collector := kindCollector[RBACSummary]{kind: "Role", group: "rbac.authorization.k8s.io", resource: "roles", available: lister != nil}
	if lister != nil {
		collector.collect = func(meta ClusterMeta, namespace string) ([]RBACSummary, uint64, error) {
			items, err := listRoles(lister, namespace)
			if err != nil {
				return nil, 0, err
			}
			rows := make([]RBACSummary, 0, len(items))
			var version uint64
			for _, r := range items {
				if r == nil {
					continue
				}
				rows = append(rows, rolepkg.BuildStreamSummary(meta, r))
				if v := resourceVersionOrTimestamp(r); v > version {
					version = v
				}
			}
			return rows, version, nil
		}
	}
	return collector
}

func newRoleBindingCollector(lister rbaclisters.RoleBindingLister) kindCollector[RBACSummary] {
	collector := kindCollector[RBACSummary]{kind: "RoleBinding", group: "rbac.authorization.k8s.io", resource: "rolebindings", available: lister != nil}
	if lister != nil {
		collector.collect = func(meta ClusterMeta, namespace string) ([]RBACSummary, uint64, error) {
			items, err := listRoleBindings(lister, namespace)
			if err != nil {
				return nil, 0, err
			}
			rows := make([]RBACSummary, 0, len(items))
			var version uint64
			for _, binding := range items {
				if binding == nil {
					continue
				}
				rows = append(rows, rolebinding.BuildStreamSummary(meta, binding))
				if v := resourceVersionOrTimestamp(binding); v > version {
					version = v
				}
			}
			return rows, version, nil
		}
	}
	return collector
}

func newServiceAccountCollector(lister corelisters.ServiceAccountLister) kindCollector[RBACSummary] {
	collector := kindCollector[RBACSummary]{kind: "ServiceAccount", group: "", resource: "serviceaccounts", available: lister != nil}
	if lister != nil {
		collector.collect = func(meta ClusterMeta, namespace string) ([]RBACSummary, uint64, error) {
			items, err := listServiceAccounts(lister, namespace)
			if err != nil {
				return nil, 0, err
			}
			rows := make([]RBACSummary, 0, len(items))
			var version uint64
			for _, sa := range items {
				if sa == nil {
					continue
				}
				rows = append(rows, serviceaccount.BuildStreamSummary(meta, sa))
				if v := resourceVersionOrTimestamp(sa); v > version {
					version = v
				}
			}
			return rows, version, nil
		}
	}
	return collector
}

func listRoles(lister rbaclisters.RoleLister, namespace string) ([]*rbacv1.Role, error) {
	if namespace == "" {
		return lister.List(labels.Everything())
	}
	return lister.Roles(namespace).List(labels.Everything())
}

func listRoleBindings(lister rbaclisters.RoleBindingLister, namespace string) ([]*rbacv1.RoleBinding, error) {
	if namespace == "" {
		return lister.List(labels.Everything())
	}
	return lister.RoleBindings(namespace).List(labels.Everything())
}

func listServiceAccounts(lister corelisters.ServiceAccountLister, namespace string) ([]*corev1.ServiceAccount, error) {
	if namespace == "" {
		return lister.List(labels.Everything())
	}
	return lister.ServiceAccounts(namespace).List(labels.Everything())
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
