package rbac

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func (s *Service) RoleBinding(namespace, name string) (*restypes.RoleBindingDetails, error) {
	rb, err := s.deps.Common.KubernetesClient.RbacV1().RoleBindings(namespace).Get(s.deps.Common.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Common.Logger.Error(fmt.Sprintf("Failed to get role binding %s/%s: %v", namespace, name, err), "RBAC")
		return nil, fmt.Errorf("failed to get role binding: %v", err)
	}
	return buildRoleBindingDetails(rb), nil
}

func (s *Service) RoleBindings(namespace string) ([]*restypes.RoleBindingDetails, error) {
	roleBindings, err := s.deps.Common.KubernetesClient.RbacV1().RoleBindings(namespace).List(s.deps.Common.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Common.Logger.Error(fmt.Sprintf("Failed to list role bindings in namespace %s: %v", namespace, err), "RBAC")
		return nil, fmt.Errorf("failed to list role bindings: %v", err)
	}

	results := make([]*restypes.RoleBindingDetails, 0, len(roleBindings.Items))
	for i := range roleBindings.Items {
		results = append(results, buildRoleBindingDetails(&roleBindings.Items[i]))
	}
	return results, nil
}

func buildRoleBindingDetails(rb *rbacv1.RoleBinding) *restypes.RoleBindingDetails {
	details := &restypes.RoleBindingDetails{
		Kind:        "RoleBinding",
		Name:        rb.Name,
		Namespace:   rb.Namespace,
		Age:         common.FormatAge(rb.CreationTimestamp.Time),
		Labels:      rb.Labels,
		Annotations: rb.Annotations,
		RoleRef: restypes.RoleRef{
			APIGroup: rb.RoleRef.APIGroup,
			Kind:     rb.RoleRef.Kind,
			Name:     rb.RoleRef.Name,
		},
	}

	subjectTypes := make(map[string]int)
	for _, subject := range rb.Subjects {
		details.Subjects = append(details.Subjects, restypes.Subject{
			Kind:      subject.Kind,
			APIGroup:  subject.APIGroup,
			Name:      subject.Name,
			Namespace: subject.Namespace,
		})
		subjectTypes[subject.Kind]++
	}

	summary := fmt.Sprintf("Subjects: %d", len(rb.Subjects))
	if len(subjectTypes) > 0 {
		summary += " ("
		first := true
		for kind, count := range subjectTypes {
			if !first {
				summary += ", "
			}
			summary += fmt.Sprintf("%d %s", count, kind)
			first = false
		}
		summary += ")"
	}
	if rb.RoleRef.Name != "" {
		summary += fmt.Sprintf(", %s: %s", rb.RoleRef.Kind, rb.RoleRef.Name)
	}
	details.Details = summary

	return details
}

func (s *Service) listRoleBindings(namespace string) *rbacv1.RoleBindingList {
	bindings, err := s.deps.Common.KubernetesClient.RbacV1().RoleBindings(namespace).List(s.deps.Common.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Common.Logger.Warn(fmt.Sprintf("Failed to list role bindings in namespace %s: %v", namespace, err), "RBAC")
		return nil
	}
	return bindings
}
