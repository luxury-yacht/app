package snapshot

import (
	"context"
	"fmt"
	"sort"

	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	"k8s.io/apimachinery/pkg/labels"
	informers "k8s.io/client-go/informers"
	corelisters "k8s.io/client-go/listers/core/v1"
	rbaclisters "k8s.io/client-go/listers/rbac/v1"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/resourcemodel"
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
	Kinds     []string      `json:"kinds,omitempty"`
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
	parsedScope, err := parseNamespaceSnapshotScope(scope, "namespace scope is required")
	if err != nil {
		return nil, err
	}
	isAll := parsedScope.AllNamespaces
	namespace := parsedScope.Namespace

	var (
		roles           []*rbacv1.Role
		bindings        []*rbacv1.RoleBinding
		serviceAccounts []*corev1.ServiceAccount
	)

	if isAll {
		if b.roleLister != nil && runtimeResourceAllowed(ctx, namespaceRBACDomainName, "rbac.authorization.k8s.io", "roles") {
			roles, err = b.roleLister.List(labels.Everything())
			if err != nil {
				return nil, err
			}
		}
		if b.bindingLister != nil && runtimeResourceAllowed(ctx, namespaceRBACDomainName, "rbac.authorization.k8s.io", "rolebindings") {
			bindings, err = b.bindingLister.List(labels.Everything())
			if err != nil {
				return nil, err
			}
		}
		if b.saLister != nil && runtimeResourceAllowed(ctx, namespaceRBACDomainName, "", "serviceaccounts") {
			serviceAccounts, err = b.saLister.List(labels.Everything())
			if err != nil {
				return nil, err
			}
		}
	} else {
		if b.roleLister != nil && runtimeResourceAllowed(ctx, namespaceRBACDomainName, "rbac.authorization.k8s.io", "roles") {
			roles, err = b.roleLister.Roles(namespace).List(labels.Everything())
			if err != nil {
				return nil, err
			}
		}
		if b.bindingLister != nil && runtimeResourceAllowed(ctx, namespaceRBACDomainName, "rbac.authorization.k8s.io", "rolebindings") {
			bindings, err = b.bindingLister.RoleBindings(namespace).List(labels.Everything())
			if err != nil {
				return nil, err
			}
		}
		if b.saLister != nil && runtimeResourceAllowed(ctx, namespaceRBACDomainName, "", "serviceaccounts") {
			serviceAccounts, err = b.saLister.ServiceAccounts(namespace).List(labels.Everything())
			if err != nil {
				return nil, err
			}
		}
	}

	return buildNamespaceRBACSnapshot(meta, parsedScope.CanonicalScope, roles, bindings, serviceAccounts)
}

func buildNamespaceRBACSnapshot(
	meta ClusterMeta,
	scope string,
	roles []*rbacv1.Role,
	bindings []*rbacv1.RoleBinding,
	serviceAccounts []*corev1.ServiceAccount,
) (*refresh.Snapshot, error) {
	resources := make([]RBACSummary, 0, len(roles)+len(bindings)+len(serviceAccounts))
	var version uint64

	// Delegate to the shared row builders so the full-snapshot path and
	// the streaming/incremental update path emit identical row shapes.
	// See BuildRoleSummary / BuildRoleBindingSummary / BuildServiceAccountSummary
	// in streaming_helpers.go.
	for _, role := range roles {
		if role == nil {
			continue
		}
		resources = append(resources, BuildRoleSummary(meta, role))
		if v := resourceVersionOrTimestamp(role); v > version {
			version = v
		}
	}

	for _, binding := range bindings {
		if binding == nil {
			continue
		}
		resources = append(resources, BuildRoleBindingSummary(meta, binding))
		if v := resourceVersionOrTimestamp(binding); v > version {
			version = v
		}
	}

	for _, sa := range serviceAccounts {
		if sa == nil {
			continue
		}
		resources = append(resources, BuildServiceAccountSummary(meta, sa))
		if v := resourceVersionOrTimestamp(sa); v > version {
			version = v
		}
	}

	sortRBACSummaries(resources)

	return &refresh.Snapshot{
		Domain:  namespaceRBACDomainName,
		Scope:   scope,
		Version: version,
		Payload: NamespaceRBACSnapshot{
			ClusterMeta: meta,
			Resources:   resources,
			Kinds:       snapshotSortedKinds(resources, func(resource RBACSummary) string { return resource.Kind }),
		},
		Stats: refresh.SnapshotStats{
			ItemCount: len(resources),
		},
	}, nil
}

func describeRoleFacts(facts *resourcemodel.RoleFacts) string {
	if facts == nil {
		return ""
	}
	return fmt.Sprintf("Rules: %d", len(facts.Rules))
}

func describeRoleBindingFacts(facts *resourcemodel.RoleBindingFacts) string {
	if facts == nil {
		return ""
	}
	role := resourceLinkName(facts.RoleRef)
	if role == "" {
		role = "-"
	}
	return fmt.Sprintf("Role: %s, Subjects: %d", role, len(facts.Subjects))
}

func describeServiceAccountFacts(facts *resourcemodel.ServiceAccountFacts) string {
	if facts == nil {
		return ""
	}
	return fmt.Sprintf("Secrets: %d", len(facts.Secrets))
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
