/*
 * backend/resources/limitrange/details.go
 *
 * LimitRange resource handlers, co-located in the per-kind package.
 */

package limitrange

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Service provides detailed LimitRange views backed by shared dependencies.
type Service struct {
	deps common.Dependencies
}

// NewService constructs a LimitRange service using the supplied dependencies bundle.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// LimitRange returns a detailed limit range description.
func (s *Service) LimitRange(namespace, name string) (*LimitRangeDetails, error) {
	client := s.deps.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	lr, err := client.CoreV1().LimitRanges(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.logError(fmt.Sprintf("Failed to get limit range %s/%s: %v", namespace, name, err))
		return nil, fmt.Errorf("failed to get limit range: %v", err)
	}

	return s.buildLimitRangeDetails(lr), nil
}

// LimitRanges returns all limit ranges in a namespace.
func (s *Service) LimitRanges(namespace string) ([]*LimitRangeDetails, error) {
	client := s.deps.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	limitRanges, err := client.CoreV1().LimitRanges(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.logError(fmt.Sprintf("Failed to list limit ranges in namespace %s: %v", namespace, err))
		return nil, fmt.Errorf("failed to list limit ranges: %v", err)
	}

	result := make([]*LimitRangeDetails, 0, len(limitRanges.Items))
	for i := range limitRanges.Items {
		result = append(result, s.buildLimitRangeDetails(&limitRanges.Items[i]))
	}

	return result, nil
}

func (s *Service) buildLimitRangeDetails(lr *corev1.LimitRange) *LimitRangeDetails {
	model := BuildResourceModel(s.deps.ClusterID, lr)
	facts := BuildFacts(lr)
	details := &LimitRangeDetails{
		Kind:        "LimitRange",
		Name:        lr.Name,
		Namespace:   lr.Namespace,
		Age:         common.FormatAge(lr.CreationTimestamp.Time),
		Details:     model.Status.Label,
		Limits:      limitRangeItemsFromFacts(facts.Limits),
		Labels:      lr.Labels,
		Annotations: lr.Annotations,
	}
	return details
}

func (s *Service) logError(msg string) {
	applog.Error(s.deps.Logger, msg, logsources.ResourceLoader)
}

func limitRangeItemsFromFacts(facts []LimitRangeItemFacts) []LimitRangeItem {
	if len(facts) == 0 {
		return nil
	}
	result := make([]LimitRangeItem, 0, len(facts))
	for _, fact := range facts {
		result = append(result, LimitRangeItem{
			Kind:                 fact.Kind,
			Max:                  quantityMapStrings(fact.Max),
			Min:                  quantityMapStrings(fact.Min),
			Default:              quantityMapStrings(fact.Default),
			DefaultRequest:       quantityMapStrings(fact.DefaultRequest),
			MaxLimitRequestRatio: quantityMapStrings(fact.MaxLimitRequestRatio),
		})
	}
	return result
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
