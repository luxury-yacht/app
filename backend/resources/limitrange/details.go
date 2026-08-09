/*
 * backend/resources/limitrange/details.go
 *
 * LimitRange resource handlers, co-located in the per-kind package.
 */

package limitrange

import (
	"context"
	"fmt"

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
func (s *Service) LimitRange(ctx context.Context, namespace, name string) (*LimitRangeDetails, error) {
	client := s.deps.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	lr, err := client.CoreV1().LimitRanges(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		err = s.logError(err, fmt.Sprintf("Failed to get limit range %s/%s", namespace, name))
		return nil, fmt.Errorf("failed to get limit range: %w", err)
	}

	return s.buildLimitRangeDetails(lr), nil
}

func (s *Service) buildLimitRangeDetails(lr *corev1.LimitRange) *LimitRangeDetails {
	model := BuildResourceModel(s.deps.ClusterID, lr)
	facts := BuildFacts(lr)
	details := &LimitRangeDetails{
		Kind:        "LimitRange",
		Name:        lr.Name,
		Namespace:   lr.Namespace,
		Details:     model.Status.Label,
		Limits:      limitRangeItemsFromFacts(facts.Limits),
		Labels:      lr.Labels,
		Annotations: lr.Annotations,
	}
	return details
}

func (s *Service) logError(err error, msg string) error {
	return s.deps.LogResourceRequestFailure(err, msg, "get", Identity, logsources.ResourceLoader)
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
