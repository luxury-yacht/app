/*
 * backend/resources/rolebinding/details.go
 *
 * RoleBinding resource handlers, co-located in the per-kind package. Intrinsic
 * fields come from the single model (rolebinding.Facts).
 */

package rolebinding

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Service provides detailed RoleBinding views backed by shared dependencies.
type Service struct {
	deps common.Dependencies
}

// NewService constructs a RoleBinding service using the supplied dependencies bundle.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// RoleBinding returns the detailed view for a single role binding.
func (s *Service) RoleBinding(namespace, name string) (*RoleBindingDetails, error) {
	rb, err := s.deps.KubernetesClient.RbacV1().RoleBindings(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get role binding %s/%s: %v", namespace, name, err), "RBAC")
		return nil, fmt.Errorf("failed to get role binding: %v", err)
	}
	return s.buildRoleBindingDetails(rb), nil
}

// RoleBindings returns detailed views for all role bindings in a namespace.
func (s *Service) RoleBindings(namespace string) ([]*RoleBindingDetails, error) {
	roleBindings, err := s.deps.KubernetesClient.RbacV1().RoleBindings(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to list role bindings in namespace %s: %v", namespace, err), "RBAC")
		return nil, fmt.Errorf("failed to list role bindings: %v", err)
	}

	results := make([]*RoleBindingDetails, 0, len(roleBindings.Items))
	for i := range roleBindings.Items {
		results = append(results, s.buildRoleBindingDetails(&roleBindings.Items[i]))
	}
	return results, nil
}

func (s *Service) buildRoleBindingDetails(rb *rbacv1.RoleBinding) *RoleBindingDetails {
	facts := BuildFacts(s.deps.ClusterID, rb)
	return &RoleBindingDetails{
		Kind:        "RoleBinding",
		Name:        rb.Name,
		Namespace:   rb.Namespace,
		Age:         common.FormatAge(rb.CreationTimestamp.Time),
		Details:     detailsSummary(facts),
		Labels:      rb.Labels,
		Annotations: rb.Annotations,
		RoleRef:     restypes.RoleRefFromResourceLink(facts.RoleRef),
		Subjects:    restypes.SubjectsFromFacts(facts.Subjects),
	}
}
