/*
 * backend/resources/constraints/resource_quotas.go
 *
 * ResourceQuota resource handlers.
 * - Builds detail and list views for the frontend.
 */

package constraints

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/types"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ResourceQuota returns a detailed quota description.
func (s *Service) ResourceQuota(namespace, name string) (*types.ResourceQuotaDetails, error) {
	client := s.deps.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	rq, err := client.CoreV1().ResourceQuotas(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.logError(fmt.Sprintf("Failed to get resource quota %s/%s: %v", namespace, name, err))
		return nil, fmt.Errorf("failed to get resource quota: %v", err)
	}

	return s.buildResourceQuotaDetails(rq), nil
}

// ResourceQuotas returns all quotas in a namespace.
func (s *Service) ResourceQuotas(namespace string) ([]*types.ResourceQuotaDetails, error) {
	client := s.deps.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	rqs, err := client.CoreV1().ResourceQuotas(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.logError(fmt.Sprintf("Failed to list resource quotas in namespace %s: %v", namespace, err))
		return nil, fmt.Errorf("failed to list resource quotas: %v", err)
	}

	result := make([]*types.ResourceQuotaDetails, 0, len(rqs.Items))
	for i := range rqs.Items {
		result = append(result, s.buildResourceQuotaDetails(&rqs.Items[i]))
	}

	return result, nil
}

func (s *Service) buildResourceQuotaDetails(rq *corev1.ResourceQuota) *types.ResourceQuotaDetails {
	model := resourcemodel.BuildResourceQuotaResourceModel(s.deps.ClusterID, rq)
	facts := model.Facts.ResourceQuota
	details := &types.ResourceQuotaDetails{
		Kind:           "ResourceQuota",
		Name:           rq.Name,
		Namespace:      rq.Namespace,
		Age:            common.FormatAge(rq.CreationTimestamp.Time),
		Details:        model.Status.Label,
		Hard:           quantityMapStrings(facts.Hard),
		Used:           quantityMapStrings(facts.Used),
		Scopes:         append([]string(nil), facts.Scopes...),
		ScopeSelector:  scopeSelectorFromFacts(facts.ScopeSelector),
		UsedPercentage: copyIntMap(facts.UsedPercentage),
		Labels:         rq.Labels,
		Annotations:    rq.Annotations,
	}
	return details
}
