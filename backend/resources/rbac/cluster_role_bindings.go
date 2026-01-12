/*
 * backend/resources/rbac/cluster_role_bindings.go
 *
 * ClusterRoleBinding resource handlers.
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

func (s *Service) ClusterRoleBinding(name string) (*restypes.ClusterRoleBindingDetails, error) {
	crb, err := s.deps.KubernetesClient.RbacV1().ClusterRoleBindings().Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get cluster role binding %s: %v", name, err), "RBAC")
		return nil, fmt.Errorf("failed to get cluster role binding: %v", err)
	}
	return buildClusterRoleBindingDetails(crb), nil
}

func (s *Service) ClusterRoleBindings() ([]*restypes.ClusterRoleBindingDetails, error) {
	bindings, err := s.deps.KubernetesClient.RbacV1().ClusterRoleBindings().List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to list cluster role bindings: %v", err), "RBAC")
		return nil, fmt.Errorf("failed to list cluster role bindings: %v", err)
	}

	results := make([]*restypes.ClusterRoleBindingDetails, 0, len(bindings.Items))
	for i := range bindings.Items {
		results = append(results, buildClusterRoleBindingDetails(&bindings.Items[i]))
	}
	return results, nil
}

func buildClusterRoleBindingDetails(crb *rbacv1.ClusterRoleBinding) *restypes.ClusterRoleBindingDetails {
	details := &restypes.ClusterRoleBindingDetails{
		Kind:        "ClusterRoleBinding",
		Name:        crb.Name,
		Age:         common.FormatAge(crb.CreationTimestamp.Time),
		Labels:      crb.Labels,
		Annotations: crb.Annotations,
		RoleRef: restypes.RoleRef{
			APIGroup: crb.RoleRef.APIGroup,
			Kind:     crb.RoleRef.Kind,
			Name:     crb.RoleRef.Name,
		},
	}

	for _, subject := range crb.Subjects {
		details.Subjects = append(details.Subjects, restypes.Subject{
			Kind:      subject.Kind,
			APIGroup:  subject.APIGroup,
			Name:      subject.Name,
			Namespace: subject.Namespace,
		})
	}

	details.Details = fmt.Sprintf("Role: %s, Subjects: %d", crb.RoleRef.Name, len(crb.Subjects))
	return details
}

func (s *Service) listClusterRoleBindings() *rbacv1.ClusterRoleBindingList {
	bindings, err := s.deps.KubernetesClient.RbacV1().ClusterRoleBindings().List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Warn(fmt.Sprintf("Failed to list cluster role bindings: %v", err), "RBAC")
		return nil
	}
	return bindings
}
