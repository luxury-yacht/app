/*
 * backend/resources/clusterrole/details.go
 *
 * ClusterRole resource handlers, co-located in the per-kind package. The detail
 * view materializes reverse links by building a relationship index from all
 * ClusterRoleBindings and RoleBindings.
 */

package clusterrole

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Service provides detailed ClusterRole views backed by shared dependencies.
type Service struct {
	deps common.Dependencies
}

// NewService constructs a ClusterRole service using the supplied dependencies bundle.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// ClusterRole returns the detailed view for a single cluster role.
func (s *Service) ClusterRole(name string) (*ClusterRoleDetails, error) {
	cr, err := s.deps.KubernetesClient.RbacV1().ClusterRoles().Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get cluster role %s: %v", name, err), "RBAC")
		return nil, fmt.Errorf("failed to get cluster role: %v", err)
	}
	return s.buildClusterRoleDetails(cr, s.listClusterRoleBindings(), s.listAllRoleBindings()), nil
}

// ClusterRoles returns detailed views for all cluster roles.
func (s *Service) ClusterRoles() ([]*ClusterRoleDetails, error) {
	roles, err := s.deps.KubernetesClient.RbacV1().ClusterRoles().List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to list cluster roles: %v", err), "RBAC")
		return nil, fmt.Errorf("failed to list cluster roles: %v", err)
	}

	clusterRoleBindings := s.listClusterRoleBindings()
	roleBindings := s.listAllRoleBindings()
	results := make([]*ClusterRoleDetails, 0, len(roles.Items))
	for i := range roles.Items {
		results = append(results, s.buildClusterRoleDetails(&roles.Items[i], clusterRoleBindings, roleBindings))
	}
	return results, nil
}

func (s *Service) listClusterRoleBindings() *rbacv1.ClusterRoleBindingList {
	bindings, err := s.deps.KubernetesClient.RbacV1().ClusterRoleBindings().List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Warn(fmt.Sprintf("Failed to list cluster role bindings: %v", err), "RBAC")
		return nil
	}
	return bindings
}

func (s *Service) listAllRoleBindings() *rbacv1.RoleBindingList {
	bindings, err := s.deps.KubernetesClient.RbacV1().RoleBindings(metav1.NamespaceAll).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Warn(fmt.Sprintf("Failed to list role bindings across all namespaces: %v", err), "RBAC")
		return nil
	}
	return bindings
}

func (s *Service) buildClusterRoleDetails(cr *rbacv1.ClusterRole, clusterRoleBindings *rbacv1.ClusterRoleBindingList, roleBindings *rbacv1.RoleBindingList) *ClusterRoleDetails {
	relationships := resourcemodel.NewResourceRelationshipIndex(
		s.deps.ClusterID,
		resourcemodel.ResourceRelationshipIndexOptions{
			RoleBindings:        roleBindings,
			ClusterRoleBindings: clusterRoleBindings,
		},
	)
	facts := BuildFacts(cr, relationships, resourcemodel.ResourceModelBuildOptions{
		Materialization: resourcemodel.MaterializeSummaryFacts | resourcemodel.MaterializeReverseLinks,
	})
	details := &ClusterRoleDetails{
		Kind:                "ClusterRole",
		Name:                cr.Name,
		Age:                 common.FormatAge(cr.CreationTimestamp.Time),
		Details:             DescribeSummary(facts),
		Rules:               restypes.PolicyRulesFromFacts(facts.Rules),
		AggregationRule:     aggregationRuleFromFacts(facts.AggregationRule),
		Labels:              cr.Labels,
		Annotations:         cr.Annotations,
		ClusterRoleBindings: restypes.ObjectRefsFromResourceLinks(facts.ClusterRoleBindings),
		RoleBindings:        restypes.ObjectRefsFromResourceLinks(facts.RoleBindings),
	}
	return details
}

func aggregationRuleFromFacts(facts *AggregationRuleFacts) *AggregationRule {
	if facts == nil {
		return nil
	}
	rule := &AggregationRule{}
	for _, selector := range facts.ClusterRoleSelectors {
		next := make(map[string]string, len(selector))
		for key, value := range selector {
			next[key] = value
		}
		rule.ClusterRoleSelectors = append(rule.ClusterRoleSelectors, next)
	}
	return rule
}
