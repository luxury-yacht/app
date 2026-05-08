/*
 * backend/resources/rbac/cluster_role_bindings.go
 *
 * ClusterRoleBinding resource handlers.
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

func (s *Service) ClusterRoleBinding(name string) (*types.ClusterRoleBindingDetails, error) {
	crb, err := s.deps.KubernetesClient.RbacV1().ClusterRoleBindings().Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get cluster role binding %s: %v", name, err), "RBAC")
		return nil, fmt.Errorf("failed to get cluster role binding: %v", err)
	}
	return s.buildClusterRoleBindingDetails(crb), nil
}

func (s *Service) ClusterRoleBindings() ([]*types.ClusterRoleBindingDetails, error) {
	bindings, err := s.deps.KubernetesClient.RbacV1().ClusterRoleBindings().List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to list cluster role bindings: %v", err), "RBAC")
		return nil, fmt.Errorf("failed to list cluster role bindings: %v", err)
	}

	results := make([]*types.ClusterRoleBindingDetails, 0, len(bindings.Items))
	for i := range bindings.Items {
		results = append(results, s.buildClusterRoleBindingDetails(&bindings.Items[i]))
	}
	return results, nil
}

func (s *Service) buildClusterRoleBindingDetails(crb *rbacv1.ClusterRoleBinding) *types.ClusterRoleBindingDetails {
	model := resourcemodel.BuildClusterRoleBindingResourceModel(s.deps.ClusterID, crb)
	facts := model.Facts.ClusterRoleBinding
	details := &types.ClusterRoleBindingDetails{
		Kind:        "ClusterRoleBinding",
		Name:        crb.Name,
		Age:         common.FormatAge(crb.CreationTimestamp.Time),
		Details:     clusterRoleBindingDetailsSummary(facts),
		Labels:      crb.Labels,
		Annotations: crb.Annotations,
		RoleRef:     roleRefFromResourceLink(facts.RoleRef),
		Subjects:    subjectsFromFacts(facts.Subjects),
	}
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
