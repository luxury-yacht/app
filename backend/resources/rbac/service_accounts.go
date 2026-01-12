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
