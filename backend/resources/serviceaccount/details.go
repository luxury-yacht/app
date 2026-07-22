/*
 * backend/resources/serviceaccount/details.go
 *
 * ServiceAccount resource handlers, co-located in the per-kind package. The detail
 * view materializes reverse links by building a relationship index from the
 * namespace's pods, role bindings, and the cluster's cluster role bindings.
 */

package serviceaccount

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Service provides detailed ServiceAccount views backed by shared dependencies.
type Service struct {
	deps common.Dependencies
}

// NewService constructs a ServiceAccount service using the supplied dependencies bundle.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// ServiceAccount returns the detailed view for a single service account.
func (s *Service) ServiceAccount(namespace, name string) (*ServiceAccountDetails, error) {
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

func (s *Service) listNamespacePods(namespace string) *corev1.PodList {
	pods, err := s.deps.KubernetesClient.CoreV1().Pods(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Warn(fmt.Sprintf("Failed to list pods in namespace %s: %v", namespace, err), "RBAC")
		return nil
	}
	return pods
}

func (s *Service) listRoleBindings(namespace string) *rbacv1.RoleBindingList {
	bindings, err := s.deps.KubernetesClient.RbacV1().RoleBindings(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Warn(fmt.Sprintf("Failed to list role bindings in namespace %s: %v", namespace, err), "RBAC")
		return nil
	}
	return bindings
}

func (s *Service) listClusterRoleBindings() *rbacv1.ClusterRoleBindingList {
	bindings, err := s.deps.KubernetesClient.RbacV1().ClusterRoleBindings().List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Warn(fmt.Sprintf("Failed to list cluster role bindings: %v", err), "RBAC")
		return nil
	}
	return bindings
}

func (s *Service) buildServiceAccountDetails(sa *corev1.ServiceAccount, pods *corev1.PodList, roleBindings *rbacv1.RoleBindingList, clusterRoleBindings *rbacv1.ClusterRoleBindingList) *ServiceAccountDetails {
	relationships := resourcemodel.NewResourceRelationshipIndex(
		s.deps.ClusterID,
		resourcemodel.ResourceRelationshipIndexOptions{
			Pods:                pods,
			RoleBindings:        roleBindings,
			ClusterRoleBindings: clusterRoleBindings,
		},
	)
	facts := BuildFacts(s.deps.ClusterID, sa, relationships, resourcemodel.ResourceModelBuildOptions{
		Materialization: resourcemodel.MaterializeSummaryFacts | resourcemodel.MaterializeReverseLinks,
	})
	details := &ServiceAccountDetails{
		Kind:                         "ServiceAccount",
		Name:                         sa.Name,
		Namespace:                    sa.Namespace,
		Details:                      detailsSummary(facts),
		Secrets:                      restypes.ObjectRefsFromResourceLinks(facts.Secrets),
		ImagePullSecrets:             restypes.ObjectRefsFromResourceLinks(facts.ImagePullSecrets),
		AutomountServiceAccountToken: facts.AutomountToken,
		Labels:                       sa.Labels,
		Annotations:                  sa.Annotations,
		UsedByPods:                   restypes.ObjectRefsFromResourceLinks(facts.UsedByPods),
		RoleBindings:                 restypes.ObjectRefsFromResourceLinks(facts.RoleBindings),
		ClusterRoleBindings:          restypes.ObjectRefsFromResourceLinks(facts.ClusterRoleBindings),
	}
	return details
}
