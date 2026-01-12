package constraints

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// LimitRange returns a detailed limit range description.
func (s *Service) LimitRange(namespace, name string) (*restypes.LimitRangeDetails, error) {
	client := s.deps.Common.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	lr, err := client.CoreV1().LimitRanges(namespace).Get(s.deps.Common.Context, name, metav1.GetOptions{})
	if err != nil {
		s.logError(fmt.Sprintf("Failed to get limit range %s/%s: %v", namespace, name, err))
		return nil, fmt.Errorf("failed to get limit range: %v", err)
	}

	return s.buildLimitRangeDetails(lr), nil
}

// LimitRanges returns all limit ranges in a namespace.
func (s *Service) LimitRanges(namespace string) ([]*restypes.LimitRangeDetails, error) {
	client := s.deps.Common.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	limitRanges, err := client.CoreV1().LimitRanges(namespace).List(s.deps.Common.Context, metav1.ListOptions{})
	if err != nil {
		s.logError(fmt.Sprintf("Failed to list limit ranges in namespace %s: %v", namespace, err))
		return nil, fmt.Errorf("failed to list limit ranges: %v", err)
	}

	result := make([]*restypes.LimitRangeDetails, 0, len(limitRanges.Items))
	for i := range limitRanges.Items {
		result = append(result, s.buildLimitRangeDetails(&limitRanges.Items[i]))
	}

	return result, nil
}

func (s *Service) buildLimitRangeDetails(lr *corev1.LimitRange) *restypes.LimitRangeDetails {
	details := &restypes.LimitRangeDetails{
		Kind:        "LimitRange",
		Name:        lr.Name,
		Namespace:   lr.Namespace,
		Age:         common.FormatAge(lr.CreationTimestamp.Time),
		Labels:      lr.Labels,
		Annotations: lr.Annotations,
	}

	for _, limit := range lr.Spec.Limits {
		item := restypes.LimitRangeItem{
			Kind:                 string(limit.Type),
			Max:                  make(map[string]string),
			Min:                  make(map[string]string),
			Default:              make(map[string]string),
			DefaultRequest:       make(map[string]string),
			MaxLimitRequestRatio: make(map[string]string),
		}

		for resourceName, quantity := range limit.Max {
			item.Max[string(resourceName)] = quantity.String()
		}
		for resourceName, quantity := range limit.Min {
			item.Min[string(resourceName)] = quantity.String()
		}
		for resourceName, quantity := range limit.Default {
			item.Default[string(resourceName)] = quantity.String()
		}
		for resourceName, quantity := range limit.DefaultRequest {
			item.DefaultRequest[string(resourceName)] = quantity.String()
		}
		for resourceName, quantity := range limit.MaxLimitRequestRatio {
			item.MaxLimitRequestRatio[string(resourceName)] = quantity.String()
		}

		details.Limits = append(details.Limits, item)
	}

	details.Details = fmt.Sprintf("%d limit(s)", len(details.Limits))
	if len(details.Limits) > 0 {
		details.Details += fmt.Sprintf(" - Type: %s", details.Limits[0].Kind)
	}

	return details
}

func (s *Service) logError(msg string) {
	if s.deps.Common.Logger != nil {
		s.deps.Common.Logger.Error(msg, "ResourceLoader")
	}
}
