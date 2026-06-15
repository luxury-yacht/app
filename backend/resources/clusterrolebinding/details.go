/*
 * backend/resources/clusterrolebinding/details.go
 *
 * ClusterRoleBinding resource handlers, co-located in the per-kind package.
 * Intrinsic fields come from the single model (clusterrolebinding.Facts).
 */

package clusterrolebinding

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Service provides detailed ClusterRoleBinding views backed by shared dependencies.
type Service struct {
	deps common.Dependencies
}

// NewService constructs a ClusterRoleBinding service using the supplied dependencies bundle.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// ClusterRoleBinding returns the detailed view for a single cluster role binding.
func (s *Service) ClusterRoleBinding(name string) (*ClusterRoleBindingDetails, error) {
	crb, err := s.deps.KubernetesClient.RbacV1().ClusterRoleBindings().Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get cluster role binding %s: %v", name, err), "RBAC")
		return nil, fmt.Errorf("failed to get cluster role binding: %v", err)
	}
	return s.buildClusterRoleBindingDetails(crb), nil
}

// ClusterRoleBindings returns detailed views for all cluster role bindings.
func (s *Service) ClusterRoleBindings() ([]*ClusterRoleBindingDetails, error) {
	bindings, err := s.deps.KubernetesClient.RbacV1().ClusterRoleBindings().List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to list cluster role bindings: %v", err), "RBAC")
		return nil, fmt.Errorf("failed to list cluster role bindings: %v", err)
	}

	results := make([]*ClusterRoleBindingDetails, 0, len(bindings.Items))
	for i := range bindings.Items {
		results = append(results, s.buildClusterRoleBindingDetails(&bindings.Items[i]))
	}
	return results, nil
}

func (s *Service) buildClusterRoleBindingDetails(crb *rbacv1.ClusterRoleBinding) *ClusterRoleBindingDetails {
	facts := BuildFacts(s.deps.ClusterID, crb)
	return &ClusterRoleBindingDetails{
		Kind:        "ClusterRoleBinding",
		Name:        crb.Name,
		Age:         common.FormatAge(crb.CreationTimestamp.Time),
		Details:     detailsSummary(facts),
		Labels:      crb.Labels,
		Annotations: crb.Annotations,
		RoleRef:     restypes.RoleRefFromResourceLink(facts.RoleRef),
		Subjects:    restypes.SubjectsFromFacts(facts.Subjects),
	}
}
