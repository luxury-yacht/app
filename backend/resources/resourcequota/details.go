/*
 * backend/resources/resourcequota/details.go
 *
 * ResourceQuota resource handlers, co-located in the per-kind package.
 */

package resourcequota

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Service provides detailed ResourceQuota views backed by shared dependencies.
type Service struct {
	deps common.Dependencies
}

// NewService constructs a ResourceQuota service using the supplied dependencies bundle.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// ResourceQuota returns a detailed quota description.
func (s *Service) ResourceQuota(namespace, name string) (*ResourceQuotaDetails, error) {
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

func (s *Service) buildResourceQuotaDetails(rq *corev1.ResourceQuota) *ResourceQuotaDetails {
	model := BuildResourceModel(s.deps.ClusterID, rq)
	facts := BuildFacts(rq)
	details := &ResourceQuotaDetails{
		Kind:           "ResourceQuota",
		Name:           rq.Name,
		Namespace:      rq.Namespace,
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

func (s *Service) logError(msg string) {
	applog.Error(s.deps.Logger, msg, logsources.ResourceLoader)
}

func scopeSelectorFromFacts(facts *ScopeSelectorFacts) *ScopeSelector {
	if facts == nil {
		return nil
	}
	selector := &ScopeSelector{}
	for _, expr := range facts.MatchExpressions {
		selector.MatchExpressions = append(selector.MatchExpressions, ScopeSelectorRequirement{
			ScopeName: expr.ScopeName,
			Operator:  expr.Operator,
			Values:    append([]string(nil), expr.Values...),
		})
	}
	return selector
}

func quantityMapStrings(values resourcemodel.ResourceQuantityMapFacts) map[string]string {
	if len(values) == 0 {
		return nil
	}
	result := make(map[string]string, len(values))
	for key, value := range values {
		result[key] = value.String()
	}
	return result
}

func copyIntMap(values map[string]int) map[string]int {
	if len(values) == 0 {
		return nil
	}
	result := make(map[string]int, len(values))
	for key, value := range values {
		result[key] = value
	}
	return result
}
