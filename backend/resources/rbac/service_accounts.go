/*
 * backend/resources/rbac/service_accounts.go
 *
 * ServiceAccount resource handlers.
 * - Builds detail and list views for the frontend.
 */

package rbac

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/types"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func (s *Service) listNamespacePods(namespace string) *corev1.PodList {
	pods, err := s.deps.KubernetesClient.CoreV1().Pods(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Warn(fmt.Sprintf("Failed to list pods in namespace %s: %v", namespace, err), "RBAC")
		return nil
	}
	return pods
}

func (s *Service) ServiceAccount(namespace, name string) (*types.ServiceAccountDetails, error) {
	sa, err := s.deps.KubernetesClient.CoreV1().ServiceAccounts(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get service account %s/%s: %v", namespace, name, err), "RBAC")
		return nil, fmt.Errorf("failed to get service account: %v", err)
	}

	pods := s.listNamespacePods(namespace)
	roleBindings := s.listRoleBindings(namespace)
	clusterRoleBindings := s.listClusterRoleBindings()

	return s.buildServiceAccountDetails(sa, pods, roleBindings, clusterRoleBindings), nil
}

func (s *Service) ServiceAccounts(namespace string) ([]*types.ServiceAccountDetails, error) {
	serviceAccounts, err := s.deps.KubernetesClient.CoreV1().ServiceAccounts(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to list service accounts in namespace %s: %v", namespace, err), "RBAC")
		return nil, fmt.Errorf("failed to list service accounts: %v", err)
	}

	pods := s.listNamespacePods(namespace)
	roleBindings := s.listRoleBindings(namespace)
	clusterRoleBindings := s.listClusterRoleBindings()

	results := make([]*types.ServiceAccountDetails, 0, len(serviceAccounts.Items))
	for i := range serviceAccounts.Items {
		sa := serviceAccounts.Items[i]
		results = append(results, s.buildServiceAccountDetails(&sa, pods, roleBindings, clusterRoleBindings))
	}
	return results, nil
}

func (s *Service) buildServiceAccountDetails(sa *corev1.ServiceAccount, pods *corev1.PodList, roleBindings *rbacv1.RoleBindingList, clusterRoleBindings *rbacv1.ClusterRoleBindingList) *types.ServiceAccountDetails {
	relationships := resourcemodel.NewResourceRelationshipIndex(
		s.deps.ClusterID,
		resourcemodel.ResourceRelationshipIndexOptions{
			Pods:                pods,
			RoleBindings:        roleBindings,
			ClusterRoleBindings: clusterRoleBindings,
		},
	)
	model := resourcemodel.BuildServiceAccountResourceModel(
		s.deps.ClusterID,
		sa,
		relationships,
		resourcemodel.ResourceModelBuildOptions{Materialization: resourcemodel.MaterializeSummaryFacts | resourcemodel.MaterializeReverseLinks},
	)
	facts := model.Facts.ServiceAccount
	details := &types.ServiceAccountDetails{
		Kind:                         "ServiceAccount",
		Name:                         sa.Name,
		Namespace:                    sa.Namespace,
		Age:                          common.FormatAge(sa.CreationTimestamp.Time),
		Details:                      serviceAccountDetailsSummary(facts),
		Secrets:                      types.ObjectRefsFromResourceLinks(facts.Secrets),
		ImagePullSecrets:             types.ObjectRefsFromResourceLinks(facts.ImagePullSecrets),
		AutomountServiceAccountToken: facts.AutomountToken,
		Labels:                       sa.Labels,
		Annotations:                  sa.Annotations,
		UsedByPods:                   types.ObjectRefsFromResourceLinks(facts.UsedByPods),
		RoleBindings:                 types.ObjectRefsFromResourceLinks(facts.RoleBindings),
		ClusterRoleBindings:          types.ObjectRefsFromResourceLinks(facts.ClusterRoleBindings),
	}
	return details
}
