/*
 * backend/resources/rbac/role_bindings.go
 *
 * RoleBinding resource handlers.
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

func (s *Service) RoleBinding(namespace, name string) (*types.RoleBindingDetails, error) {
	rb, err := s.deps.KubernetesClient.RbacV1().RoleBindings(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get role binding %s/%s: %v", namespace, name, err), "RBAC")
		return nil, fmt.Errorf("failed to get role binding: %v", err)
	}
	return s.buildRoleBindingDetails(rb), nil
}

func (s *Service) RoleBindings(namespace string) ([]*types.RoleBindingDetails, error) {
	roleBindings, err := s.deps.KubernetesClient.RbacV1().RoleBindings(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to list role bindings in namespace %s: %v", namespace, err), "RBAC")
		return nil, fmt.Errorf("failed to list role bindings: %v", err)
	}

	results := make([]*types.RoleBindingDetails, 0, len(roleBindings.Items))
	for i := range roleBindings.Items {
		results = append(results, s.buildRoleBindingDetails(&roleBindings.Items[i]))
	}
	return results, nil
}

func (s *Service) buildRoleBindingDetails(rb *rbacv1.RoleBinding) *types.RoleBindingDetails {
	model := resourcemodel.BuildRoleBindingResourceModel(s.deps.ClusterID, rb)
	facts := model.Facts.RoleBinding
	details := &types.RoleBindingDetails{
		Kind:        "RoleBinding",
		Name:        rb.Name,
		Namespace:   rb.Namespace,
		Age:         common.FormatAge(rb.CreationTimestamp.Time),
		Details:     roleBindingDetailsSummary(facts),
		Labels:      rb.Labels,
		Annotations: rb.Annotations,
		RoleRef:     roleRefFromResourceLink(facts.RoleRef),
		Subjects:    subjectsFromFacts(facts.Subjects),
	}
	return details
}

func (s *Service) listRoleBindings(namespace string) *rbacv1.RoleBindingList {
	bindings, err := s.deps.KubernetesClient.RbacV1().RoleBindings(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Warn(fmt.Sprintf("Failed to list role bindings in namespace %s: %v", namespace, err), "RBAC")
		return nil
	}
	return bindings
}
