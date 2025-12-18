package rbac

import (
	"fmt"
	"sort"

	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type Dependencies struct {
	Common common.Dependencies
}

type Service struct {
	deps Dependencies
}

func NewService(deps Dependencies) *Service {
	return &Service{deps: deps}
}

func (s *Service) Role(namespace, name string) (*restypes.RoleDetails, error) {
	role, err := s.deps.Common.KubernetesClient.RbacV1().Roles(namespace).Get(s.deps.Common.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Common.Logger.Error(fmt.Sprintf("Failed to get role %s/%s: %v", namespace, name, err), "RBAC")
		return nil, fmt.Errorf("failed to get role: %v", err)
	}

	var bindings *rbacv1.RoleBindingList
	if rbList, err := s.deps.Common.KubernetesClient.RbacV1().RoleBindings(namespace).List(s.deps.Common.Context, metav1.ListOptions{}); err != nil {
		s.deps.Common.Logger.Warn(fmt.Sprintf("Failed to list role bindings in namespace %s: %v", namespace, err), "RBAC")
	} else {
		bindings = rbList
	}

	return s.buildRoleDetails(role, bindings), nil
}

func (s *Service) Roles(namespace string) ([]*restypes.RoleDetails, error) {
	roles, err := s.deps.Common.KubernetesClient.RbacV1().Roles(namespace).List(s.deps.Common.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Common.Logger.Error(fmt.Sprintf("Failed to list roles in namespace %s: %v", namespace, err), "RBAC")
		return nil, fmt.Errorf("failed to list roles: %v", err)
	}

	var bindings *rbacv1.RoleBindingList
	if rbList, err := s.deps.Common.KubernetesClient.RbacV1().RoleBindings(namespace).List(s.deps.Common.Context, metav1.ListOptions{}); err != nil {
		s.deps.Common.Logger.Warn(fmt.Sprintf("Failed to list role bindings in namespace %s: %v", namespace, err), "RBAC")
	} else {
		bindings = rbList
	}

	results := make([]*restypes.RoleDetails, 0, len(roles.Items))
	for i := range roles.Items {
		results = append(results, s.buildRoleDetails(&roles.Items[i], bindings))
	}
	return results, nil
}

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

func (s *Service) ClusterRole(name string) (*restypes.ClusterRoleDetails, error) {
	cr, err := s.deps.Common.KubernetesClient.RbacV1().ClusterRoles().Get(s.deps.Common.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Common.Logger.Error(fmt.Sprintf("Failed to get cluster role %s: %v", name, err), "RBAC")
		return nil, fmt.Errorf("failed to get cluster role: %v", err)
	}
	return s.buildClusterRoleDetails(cr, nil, nil), nil
}

func (s *Service) ClusterRoles() ([]*restypes.ClusterRoleDetails, error) {
	roles, err := s.deps.Common.KubernetesClient.RbacV1().ClusterRoles().List(s.deps.Common.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Common.Logger.Error(fmt.Sprintf("Failed to list cluster roles: %v", err), "RBAC")
		return nil, fmt.Errorf("failed to list cluster roles: %v", err)
	}

	var crbMap map[string][]string
	if crbs, err := s.deps.Common.KubernetesClient.RbacV1().ClusterRoleBindings().List(s.deps.Common.Context, metav1.ListOptions{}); err != nil {
		s.deps.Common.Logger.Warn(fmt.Sprintf("Failed to list cluster role bindings: %v", err), "RBAC")
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

func (s *Service) ClusterRoleBinding(name string) (*restypes.ClusterRoleBindingDetails, error) {
	crb, err := s.deps.Common.KubernetesClient.RbacV1().ClusterRoleBindings().Get(s.deps.Common.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Common.Logger.Error(fmt.Sprintf("Failed to get cluster role binding %s: %v", name, err), "RBAC")
		return nil, fmt.Errorf("failed to get cluster role binding: %v", err)
	}
	return buildClusterRoleBindingDetails(crb), nil
}

func (s *Service) ClusterRoleBindings() ([]*restypes.ClusterRoleBindingDetails, error) {
	bindings, err := s.deps.Common.KubernetesClient.RbacV1().ClusterRoleBindings().List(s.deps.Common.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Common.Logger.Error(fmt.Sprintf("Failed to list cluster role bindings: %v", err), "RBAC")
		return nil, fmt.Errorf("failed to list cluster role bindings: %v", err)
	}

	results := make([]*restypes.ClusterRoleBindingDetails, 0, len(bindings.Items))
	for i := range bindings.Items {
		results = append(results, buildClusterRoleBindingDetails(&bindings.Items[i]))
	}
	return results, nil
}

func (s *Service) ServiceAccount(namespace, name string) (*restypes.ServiceAccountDetails, error) {
	sa, err := s.deps.Common.KubernetesClient.CoreV1().ServiceAccounts(namespace).Get(s.deps.Common.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Common.Logger.Error(fmt.Sprintf("Failed to get service account %s/%s: %v", namespace, name, err), "RBAC")
		return nil, fmt.Errorf("failed to get service account: %v", err)
	}

	pods := s.listNamespacePods(namespace)
	roleBindings := s.listRoleBindings(namespace)
	clusterRoleBindings := s.listClusterRoleBindings()

	return s.buildServiceAccountDetails(sa, pods, roleBindings, clusterRoleBindings), nil
}

func (s *Service) ServiceAccounts(namespace string) ([]*restypes.ServiceAccountDetails, error) {
	serviceAccounts, err := s.deps.Common.KubernetesClient.CoreV1().ServiceAccounts(namespace).List(s.deps.Common.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Common.Logger.Error(fmt.Sprintf("Failed to list service accounts in namespace %s: %v", namespace, err), "RBAC")
		return nil, fmt.Errorf("failed to list service accounts: %v", err)
	}

	pods := s.listNamespacePods(namespace)
	roleBindings := s.listRoleBindings(namespace)
	clusterRoleBindings := s.listClusterRoleBindings()

	results := make([]*restypes.ServiceAccountDetails, 0, len(serviceAccounts.Items))
	for i := range serviceAccounts.Items {
		sa := serviceAccounts.Items[i]
		results = append(results, s.buildServiceAccountDetails(&sa, pods, roleBindings, clusterRoleBindings))
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

func (s *Service) buildServiceAccountDetails(sa *corev1.ServiceAccount, pods *corev1.PodList, roleBindings *rbacv1.RoleBindingList, clusterRoleBindings *rbacv1.ClusterRoleBindingList) *restypes.ServiceAccountDetails {
	details := &restypes.ServiceAccountDetails{
		Kind:                         "ServiceAccount",
		Name:                         sa.Name,
		Namespace:                    sa.Namespace,
		Age:                          common.FormatAge(sa.CreationTimestamp.Time),
		AutomountServiceAccountToken: sa.AutomountServiceAccountToken,
		Labels:                       sa.Labels,
		Annotations:                  sa.Annotations,
	}

	for _, secret := range sa.Secrets {
		details.Secrets = append(details.Secrets, secret.Name)
	}
	for _, secret := range sa.ImagePullSecrets {
		details.ImagePullSecrets = append(details.ImagePullSecrets, secret.Name)
	}

	if pods != nil {
		usedBy := make(map[string]bool)
		for _, pod := range pods.Items {
			if pod.Spec.ServiceAccountName == sa.Name || (pod.Spec.ServiceAccountName == "" && sa.Name == "default") {
				usedBy[pod.Name] = true
			}
		}
		for name := range usedBy {
			details.UsedByPods = append(details.UsedByPods, name)
		}
		sort.Strings(details.UsedByPods)
	}

	if roleBindings != nil {
		for _, rb := range roleBindings.Items {
			for _, subject := range rb.Subjects {
				if subject.Kind == "ServiceAccount" && subject.Name == sa.Name && (subject.Namespace == "" || subject.Namespace == sa.Namespace) {
					details.RoleBindings = append(details.RoleBindings, rb.Name)
					break
				}
			}
		}
		sort.Strings(details.RoleBindings)
	}

	if clusterRoleBindings != nil {
		for _, crb := range clusterRoleBindings.Items {
			for _, subject := range crb.Subjects {
				if subject.Kind == "ServiceAccount" && subject.Name == sa.Name && subject.Namespace == sa.Namespace {
					details.ClusterRoleBindings = append(details.ClusterRoleBindings, crb.Name)
					break
				}
			}
		}
		sort.Strings(details.ClusterRoleBindings)
	}

	summary := fmt.Sprintf("Secrets: %d", len(details.Secrets))
	if len(details.ImagePullSecrets) > 0 {
		summary += fmt.Sprintf(", ImagePullSecrets: %d", len(details.ImagePullSecrets))
	}
	if len(details.UsedByPods) > 0 {
		summary += fmt.Sprintf(", Used by %d pod(s)", len(details.UsedByPods))
	}
	if len(details.RoleBindings) > 0 {
		summary += fmt.Sprintf(", RoleBindings: %d", len(details.RoleBindings))
	}
	if len(details.ClusterRoleBindings) > 0 {
		summary += fmt.Sprintf(", ClusterRoleBindings: %d", len(details.ClusterRoleBindings))
	}
	details.Details = summary

	return details
}

func (s *Service) listNamespacePods(namespace string) *corev1.PodList {
	pods, err := s.deps.Common.KubernetesClient.CoreV1().Pods(namespace).List(s.deps.Common.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Common.Logger.Warn(fmt.Sprintf("Failed to list pods in namespace %s: %v", namespace, err), "RBAC")
		return nil
	}
	return pods
}

func (s *Service) listRoleBindings(namespace string) *rbacv1.RoleBindingList {
	bindings, err := s.deps.Common.KubernetesClient.RbacV1().RoleBindings(namespace).List(s.deps.Common.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Common.Logger.Warn(fmt.Sprintf("Failed to list role bindings in namespace %s: %v", namespace, err), "RBAC")
		return nil
	}
	return bindings
}

func (s *Service) listClusterRoleBindings() *rbacv1.ClusterRoleBindingList {
	bindings, err := s.deps.Common.KubernetesClient.RbacV1().ClusterRoleBindings().List(s.deps.Common.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Common.Logger.Warn(fmt.Sprintf("Failed to list cluster role bindings: %v", err), "RBAC")
		return nil
	}
	return bindings
}
