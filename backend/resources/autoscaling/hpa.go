/*
 * backend/resources/autoscaling/hpa.go
 *
 * HorizontalPodAutoscaler resource handlers.
 * - Builds detail and list views for the frontend.
 */

package autoscaling

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/types"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// HorizontalPodAutoscaler returns a detailed view for a single HPA.
func (s *Service) HorizontalPodAutoscaler(namespace, name string) (*types.HorizontalPodAutoscalerDetails, error) {
	client := s.deps.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	hpa, err := client.AutoscalingV2().HorizontalPodAutoscalers(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.logError(fmt.Sprintf("Failed to get HPA %s/%s: %v", namespace, name, err))
		return nil, fmt.Errorf("failed to get HPA: %v", err)
	}

	return s.buildHorizontalPodAutoscalerDetails(hpa), nil
}

func (s *Service) buildHorizontalPodAutoscalerDetails(hpa *autoscalingv2.HorizontalPodAutoscaler) *types.HorizontalPodAutoscalerDetails {
	model := resourcemodel.BuildHorizontalPodAutoscalerResourceModel(s.deps.ClusterID, hpa)
	facts := model.Facts.HorizontalPodAutoscaler
	details := &types.HorizontalPodAutoscalerDetails{
		Kind:            "HorizontalPodAutoscaler",
		Name:            hpa.Name,
		Namespace:       hpa.Namespace,
		Age:             common.FormatAge(hpa.CreationTimestamp.Time),
		Details:         hpaDetailsSummary(facts),
		MinReplicas:     facts.MinReplicas,
		MaxReplicas:     facts.MaxReplicas,
		CurrentReplicas: facts.CurrentReplicas,
		DesiredReplicas: facts.DesiredReplicas,
		LastScaleTime:   facts.LastScaleTime,
		Labels:          hpa.Labels,
		Annotations:     hpa.Annotations,
		ScaleTargetRef:  scaleTargetReferenceFromFacts(facts.ScaleTarget),
		Metrics:         metricSpecsFromFacts(facts.Metrics),
		CurrentMetrics:  metricStatusesFromFacts(facts.CurrentMetrics),
		Behavior:        scalingBehaviorFromFacts(facts.Behavior),
		Conditions:      types.FormatConditions(facts.Conditions),
	}
	return details
}

func (s *Service) logError(msg string) {
	applog.Error(s.deps.Logger, msg, logsources.ResourceLoader)
}
