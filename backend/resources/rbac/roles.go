/*
 * backend/resources/rbac/roles.go
 *
 * Role resource handlers.
 * - Builds detail and list views for the frontend.
 */

package rbac

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/types"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func (s *Service) Role(namespace, name string) (*types.RoleDetails, error) {
	role, err := s.deps.KubernetesClient.RbacV1().Roles(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get role %s/%s: %v", namespace, name, err), "RBAC")
		return nil, fmt.Errorf("failed to get role: %v", err)
	}

	var bindings *rbacv1.RoleBindingList
	if rbList, err := s.deps.KubernetesClient.RbacV1().RoleBindings(namespace).List(s.deps.Context, metav1.ListOptions{}); err != nil {
		s.deps.Logger.Warn(fmt.Sprintf("Failed to list role bindings in namespace %s: %v", namespace, err), "RBAC")
	} else {
		bindings = rbList
	}

	return s.buildRoleDetails(role, bindings), nil
}

func (s *Service) Roles(namespace string) ([]*types.RoleDetails, error) {
	roles, err := s.deps.KubernetesClient.RbacV1().Roles(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to list roles in namespace %s: %v", namespace, err), "RBAC")
		return nil, fmt.Errorf("failed to list roles: %v", err)
	}

	var bindings *rbacv1.RoleBindingList
	if rbList, err := s.deps.KubernetesClient.RbacV1().RoleBindings(namespace).List(s.deps.Context, metav1.ListOptions{}); err != nil {
		s.deps.Logger.Warn(fmt.Sprintf("Failed to list role bindings in namespace %s: %v", namespace, err), "RBAC")
	} else {
		bindings = rbList
	}

	results := make([]*types.RoleDetails, 0, len(roles.Items))
	for i := range roles.Items {
		results = append(results, s.buildRoleDetails(&roles.Items[i], bindings))
	}
	return results, nil
}

func (s *Service) buildRoleDetails(role *rbacv1.Role, bindings *rbacv1.RoleBindingList) *types.RoleDetails {
	relationships := resourcemodel.NewResourceRelationshipIndex(
		s.deps.ClusterID,
		resourcemodel.ResourceRelationshipIndexOptions{RoleBindings: bindings},
	)
	model := resourcemodel.BuildRoleResourceModel(
		s.deps.ClusterID,
		role,
		relationships,
		resourcemodel.ResourceModelBuildOptions{Materialization: resourcemodel.MaterializeSummaryFacts | resourcemodel.MaterializeReverseLinks},
	)
	facts := model.Facts.Role
	details := &types.RoleDetails{
		Kind:        "Role",
		Name:        role.Name,
		Namespace:   role.Namespace,
		Age:         common.FormatAge(role.CreationTimestamp.Time),
		Details:     roleDetailsSummary(facts),
		Rules:       policyRulesFromFacts(facts.Rules),
		Labels:      role.Labels,
		Annotations: role.Annotations,
	}
	details.UsedByRoleBindings = types.ObjectRefsFromResourceLinks(facts.UsedByRoleBindings)
	return details
}
