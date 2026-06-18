/*
 * backend/resources/hpa/details.go
 *
 * HorizontalPodAutoscaler resource handlers, co-located in the per-kind package.
 * Intrinsic fields come from the single model (hpa.Facts, v2).
 */

package hpa

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Service provides detailed HorizontalPodAutoscaler views backed by shared dependencies.
type Service struct {
	deps common.Dependencies
}

// NewService constructs an HPA service using the supplied dependencies bundle.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// HorizontalPodAutoscaler returns a detailed view for a single HPA.
func (s *Service) HorizontalPodAutoscaler(namespace, name string) (*HorizontalPodAutoscalerDetails, error) {
	client := s.deps.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	h, err := client.AutoscalingV2().HorizontalPodAutoscalers(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.logError(fmt.Sprintf("Failed to get HPA %s/%s: %v", namespace, name, err))
		return nil, fmt.Errorf("failed to get HPA: %v", err)
	}

	return s.buildHorizontalPodAutoscalerDetails(h), nil
}

func (s *Service) buildHorizontalPodAutoscalerDetails(h *autoscalingv2.HorizontalPodAutoscaler) *HorizontalPodAutoscalerDetails {
	facts := BuildFacts(s.deps.ClusterID, h)
	return &HorizontalPodAutoscalerDetails{
		Kind:            "HorizontalPodAutoscaler",
		Name:            h.Name,
		Namespace:       h.Namespace,
		Age:             common.FormatAge(h.CreationTimestamp.Time),
		Details:         detailsSummary(facts),
		MinReplicas:     facts.MinReplicas,
		MaxReplicas:     facts.MaxReplicas,
		CurrentReplicas: facts.CurrentReplicas,
		DesiredReplicas: facts.DesiredReplicas,
		LastScaleTime:   facts.LastScaleTime,
		Labels:          h.Labels,
		Annotations:     h.Annotations,
		ScaleTargetRef:  scaleTargetReferenceFromFacts(facts.ScaleTarget),
		Metrics:         metricSpecsFromFacts(facts.Metrics),
		CurrentMetrics:  metricStatusesFromFacts(facts.CurrentMetrics),
		Behavior:        scalingBehaviorFromFacts(facts.Behavior),
		Conditions:      restypes.FormatConditions(facts.Conditions),
	}
}

func (s *Service) logError(msg string) {
	applog.Error(s.deps.Logger, msg, logsources.ResourceLoader)
}

func scaleTargetReferenceFromFacts(link resourcemodel.ResourceLink) ScaleTargetReference {
	kind, name := scaleTargetKindName(link)
	return ScaleTargetReference{
		Kind:       kind,
		Name:       name,
		APIVersion: scaleTargetAPIVersion(link),
	}
}

func metricSpecsFromFacts(facts []MetricFacts) []MetricSpec {
	if len(facts) == 0 {
		return nil
	}
	result := make([]MetricSpec, 0, len(facts))
	for _, fact := range facts {
		result = append(result, MetricSpec{
			Kind:   fact.Kind,
			Target: common.CopyStringMap(fact.Target),
		})
	}
	return result
}

func metricStatusesFromFacts(facts []MetricStatusFacts) []MetricStatus {
	if len(facts) == 0 {
		return nil
	}
	result := make([]MetricStatus, 0, len(facts))
	for _, fact := range facts {
		result = append(result, MetricStatus{
			Kind:    fact.Kind,
			Current: common.CopyStringMap(fact.Current),
		})
	}
	return result
}

func scalingBehaviorFromFacts(facts *ScalingBehaviorFacts) *ScalingBehavior {
	if facts == nil {
		return nil
	}
	return &ScalingBehavior{
		ScaleUp:   scalingRulesFromFacts(facts.ScaleUp),
		ScaleDown: scalingRulesFromFacts(facts.ScaleDown),
	}
}

func scalingRulesFromFacts(facts *ScalingRulesFacts) *ScalingRules {
	if facts == nil {
		return nil
	}
	return &ScalingRules{
		StabilizationWindowSeconds: facts.StabilizationWindowSeconds,
		SelectPolicy:               facts.SelectPolicy,
		Policies:                   append([]string(nil), facts.Policies...),
	}
}
