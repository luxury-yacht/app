/*
 * backend/resources/rbac/cluster_roles.go
 *
 * ClusterRole resource handlers.
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

func (s *Service) ClusterRole(name string) (*types.ClusterRoleDetails, error) {
	cr, err := s.deps.KubernetesClient.RbacV1().ClusterRoles().Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get cluster role %s: %v", name, err), "RBAC")
		return nil, fmt.Errorf("failed to get cluster role: %v", err)
	}

	var clusterRoleBindings *rbacv1.ClusterRoleBindingList
	if crbs, err := s.deps.KubernetesClient.RbacV1().ClusterRoleBindings().List(s.deps.Context, metav1.ListOptions{}); err != nil {
		s.deps.Logger.Warn(fmt.Sprintf("Failed to list cluster role bindings: %v", err), "RBAC")
	} else {
		clusterRoleBindings = crbs
	}

	return s.buildClusterRoleDetails(cr, clusterRoleBindings, s.listAllRoleBindings()), nil
}

func (s *Service) ClusterRoles() ([]*types.ClusterRoleDetails, error) {
	roles, err := s.deps.KubernetesClient.RbacV1().ClusterRoles().List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to list cluster roles: %v", err), "RBAC")
		return nil, fmt.Errorf("failed to list cluster roles: %v", err)
	}

	var clusterRoleBindings *rbacv1.ClusterRoleBindingList
	if crbs, err := s.deps.KubernetesClient.RbacV1().ClusterRoleBindings().List(s.deps.Context, metav1.ListOptions{}); err != nil {
		s.deps.Logger.Warn(fmt.Sprintf("Failed to list cluster role bindings: %v", err), "RBAC")
	} else {
		clusterRoleBindings = crbs
	}
	roleBindings := s.listAllRoleBindings()

	results := make([]*types.ClusterRoleDetails, 0, len(roles.Items))
	for i := range roles.Items {
		role := roles.Items[i]
		results = append(results, s.buildClusterRoleDetails(&role, clusterRoleBindings, roleBindings))
	}
	return results, nil
}

func (s *Service) buildClusterRoleDetails(cr *rbacv1.ClusterRole, clusterRoleBindings *rbacv1.ClusterRoleBindingList, roleBindings *rbacv1.RoleBindingList) *types.ClusterRoleDetails {
	relationships := resourcemodel.NewResourceRelationshipIndex(
		s.deps.ClusterID,
		resourcemodel.ResourceRelationshipIndexOptions{
			RoleBindings:        roleBindings,
			ClusterRoleBindings: clusterRoleBindings,
		},
	)
	model := resourcemodel.BuildClusterRoleResourceModel(
		s.deps.ClusterID,
		cr,
		relationships,
		resourcemodel.ResourceModelBuildOptions{Materialization: resourcemodel.MaterializeSummaryFacts | resourcemodel.MaterializeReverseLinks},
	)
	facts := model.Facts.ClusterRole
	details := &types.ClusterRoleDetails{
		Kind:                "ClusterRole",
		Name:                cr.Name,
		Age:                 common.FormatAge(cr.CreationTimestamp.Time),
		Details:             clusterRoleDetailsSummary(facts),
		Rules:               policyRulesFromFacts(facts.Rules),
		AggregationRule:     aggregationRuleFromFacts(facts.AggregationRule),
		Labels:              cr.Labels,
		Annotations:         cr.Annotations,
		ClusterRoleBindings: types.ObjectRefsFromResourceLinks(facts.ClusterRoleBindings),
		RoleBindings:        types.ObjectRefsFromResourceLinks(facts.RoleBindings),
	}
	return details
}

func (s *Service) listAllRoleBindings() *rbacv1.RoleBindingList {
	bindings, err := s.deps.KubernetesClient.RbacV1().RoleBindings(metav1.NamespaceAll).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Warn(fmt.Sprintf("Failed to list role bindings across all namespaces: %v", err), "RBAC")
		return nil
	}
	return bindings
}
