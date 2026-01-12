/*
 * backend/resources/rbac/roles.go
 *
 * Role resource handlers.
 * - Builds detail and list views for the frontend.
 */

package rbac

import (
	"fmt"
	"sort"

	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func (s *Service) Role(namespace, name string) (*restypes.RoleDetails, error) {
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

func (s *Service) Roles(namespace string) ([]*restypes.RoleDetails, error) {
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

	results := make([]*restypes.RoleDetails, 0, len(roles.Items))
	for i := range roles.Items {
		results = append(results, s.buildRoleDetails(&roles.Items[i], bindings))
	}
	return results, nil
}

func (s *Service) buildRoleDetails(role *rbacv1.Role, bindings *rbacv1.RoleBindingList) *restypes.RoleDetails {
	details := &restypes.RoleDetails{
		Kind:        "Role",
		Name:        role.Name,
		Namespace:   role.Namespace,
		Age:         common.FormatAge(role.CreationTimestamp.Time),
		Labels:      role.Labels,
		Annotations: role.Annotations,
	}

	for _, rule := range role.Rules {
		details.Rules = append(details.Rules, restypes.PolicyRule{
			APIGroups:       rule.APIGroups,
			Resources:       rule.Resources,
			ResourceNames:   rule.ResourceNames,
			Verbs:           rule.Verbs,
			NonResourceURLs: rule.NonResourceURLs,
		})
	}

	if bindings != nil {
		for _, rb := range bindings.Items {
			if rb.RoleRef.Kind == "Role" && rb.RoleRef.Name == role.Name {
				details.UsedByRoleBindings = append(details.UsedByRoleBindings, rb.Name)
			}
		}
		sort.Strings(details.UsedByRoleBindings)
	}

	ruleCount := len(role.Rules)
	resourceCount := 0
	verbCount := 0
	for _, rule := range role.Rules {
		resourceCount += len(rule.Resources)
		verbCount += len(rule.Verbs)
	}

	summary := fmt.Sprintf("Rules: %d", ruleCount)
	if resourceCount > 0 || verbCount > 0 {
		summary += fmt.Sprintf(" (%d resources, %d verbs)", resourceCount, verbCount)
	}
	if len(details.UsedByRoleBindings) > 0 {
		summary += fmt.Sprintf(", Used by %d binding(s)", len(details.UsedByRoleBindings))
	}
	details.Details = summary

	return details
}
