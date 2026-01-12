/*
 * backend/resources/rbac/cluster_roles.go
 *
 * ClusterRole resource handlers.
 * - Builds detail and list views for the frontend.
 */

package rbac

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func (s *Service) ClusterRole(name string) (*restypes.ClusterRoleDetails, error) {
	cr, err := s.deps.KubernetesClient.RbacV1().ClusterRoles().Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get cluster role %s: %v", name, err), "RBAC")
		return nil, fmt.Errorf("failed to get cluster role: %v", err)
	}
	return s.buildClusterRoleDetails(cr, nil, nil), nil
}

func (s *Service) ClusterRoles() ([]*restypes.ClusterRoleDetails, error) {
	roles, err := s.deps.KubernetesClient.RbacV1().ClusterRoles().List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to list cluster roles: %v", err), "RBAC")
		return nil, fmt.Errorf("failed to list cluster roles: %v", err)
	}

	var crbMap map[string][]string
	if crbs, err := s.deps.KubernetesClient.RbacV1().ClusterRoleBindings().List(s.deps.Context, metav1.ListOptions{}); err != nil {
		s.deps.Logger.Warn(fmt.Sprintf("Failed to list cluster role bindings: %v", err), "RBAC")
	} else {
		crbMap = make(map[string][]string)
		for i := range crbs.Items {
			binding := crbs.Items[i]
			if binding.RoleRef.Kind == "ClusterRole" {
				crbMap[binding.RoleRef.Name] = append(crbMap[binding.RoleRef.Name], binding.Name)
			}
		}
	}

	results := make([]*restypes.ClusterRoleDetails, 0, len(roles.Items))
	for i := range roles.Items {
		role := roles.Items[i]
		results = append(results, s.buildClusterRoleDetails(&role, crbMap[role.Name], nil))
	}
	return results, nil
}

func (s *Service) buildClusterRoleDetails(cr *rbacv1.ClusterRole, clusterRoleBindings []string, roleBindings []string) *restypes.ClusterRoleDetails {
	details := &restypes.ClusterRoleDetails{
		Kind:                "ClusterRole",
		Name:                cr.Name,
		Age:                 common.FormatAge(cr.CreationTimestamp.Time),
		Labels:              cr.Labels,
		Annotations:         cr.Annotations,
		ClusterRoleBindings: clusterRoleBindings,
		RoleBindings:        roleBindings,
	}

	for _, rule := range cr.Rules {
		details.Rules = append(details.Rules, restypes.PolicyRule{
			APIGroups:       rule.APIGroups,
			Resources:       rule.Resources,
			ResourceNames:   rule.ResourceNames,
			Verbs:           rule.Verbs,
			NonResourceURLs: rule.NonResourceURLs,
		})
	}

	if cr.AggregationRule != nil {
		agg := &restypes.AggregationRule{}
		for _, selector := range cr.AggregationRule.ClusterRoleSelectors {
			agg.ClusterRoleSelectors = append(agg.ClusterRoleSelectors, selector.MatchLabels)
		}
		details.AggregationRule = agg
	}

	summary := fmt.Sprintf("Rules: %d", len(cr.Rules))
	if cr.AggregationRule != nil {
		summary += " (aggregated)"
	}
	details.Details = summary

	return details
}
