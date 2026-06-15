/*
 * backend/resources/role/details.go
 *
 * Role resource handlers, co-located in the per-kind package. The detail view
 * materializes reverse links (UsedByRoleBindings) by building a relationship index
 * from the namespace's RoleBindings.
 */

package role

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Service provides detailed Role views backed by shared dependencies.
type Service struct {
	deps common.Dependencies
}

// NewService constructs a Role service using the supplied dependencies bundle.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// Role returns the detailed view for a single role.
func (s *Service) Role(namespace, name string) (*RoleDetails, error) {
	r, err := s.deps.KubernetesClient.RbacV1().Roles(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get role %s/%s: %v", namespace, name, err), "RBAC")
		return nil, fmt.Errorf("failed to get role: %v", err)
	}
	return s.buildRoleDetails(r, s.listRoleBindings(namespace)), nil
}

// Roles returns detailed views for all roles in a namespace.
func (s *Service) Roles(namespace string) ([]*RoleDetails, error) {
	roles, err := s.deps.KubernetesClient.RbacV1().Roles(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to list roles in namespace %s: %v", namespace, err), "RBAC")
		return nil, fmt.Errorf("failed to list roles: %v", err)
	}

	bindings := s.listRoleBindings(namespace)
	results := make([]*RoleDetails, 0, len(roles.Items))
	for i := range roles.Items {
		results = append(results, s.buildRoleDetails(&roles.Items[i], bindings))
	}
	return results, nil
}

func (s *Service) listRoleBindings(namespace string) *rbacv1.RoleBindingList {
	bindings, err := s.deps.KubernetesClient.RbacV1().RoleBindings(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Warn(fmt.Sprintf("Failed to list role bindings in namespace %s: %v", namespace, err), "RBAC")
		return nil
	}
	return bindings
}

func (s *Service) buildRoleDetails(r *rbacv1.Role, bindings *rbacv1.RoleBindingList) *RoleDetails {
	relationships := resourcemodel.NewResourceRelationshipIndex(
		s.deps.ClusterID,
		resourcemodel.ResourceRelationshipIndexOptions{RoleBindings: bindings},
	)
	facts := BuildFacts(r, relationships, resourcemodel.ResourceModelBuildOptions{
		Materialization: resourcemodel.MaterializeSummaryFacts | resourcemodel.MaterializeReverseLinks,
	})
	details := &RoleDetails{
		Kind:               "Role",
		Name:               r.Name,
		Namespace:          r.Namespace,
		Age:                common.FormatAge(r.CreationTimestamp.Time),
		Details:            detailsSummary(facts),
		Rules:              restypes.PolicyRulesFromFacts(facts.Rules),
		Labels:             r.Labels,
		Annotations:        r.Annotations,
		UsedByRoleBindings: restypes.ObjectRefsFromResourceLinks(facts.UsedByRoleBindings),
	}
	return details
}
