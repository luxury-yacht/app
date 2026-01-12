/*
 * backend/resources/autoscaling/hpa.go
 *
 * HorizontalPodAutoscaler resource handlers.
 * - Builds detail and list views for the frontend.
 */

package autoscaling

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// HorizontalPodAutoscaler returns a detailed view for a single HPA.
func (s *Service) HorizontalPodAutoscaler(namespace, name string) (*restypes.HorizontalPodAutoscalerDetails, error) {
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

// HorizontalPodAutoscalers returns detailed views for all HPAs in the namespace.
func (s *Service) HorizontalPodAutoscalers(namespace string) ([]*restypes.HorizontalPodAutoscalerDetails, error) {
	client := s.deps.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	hpas, err := client.AutoscalingV2().HorizontalPodAutoscalers(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.logError(fmt.Sprintf("Failed to list HPAs in namespace %s: %v", namespace, err))
		return nil, fmt.Errorf("failed to list HPAs: %v", err)
	}

	result := make([]*restypes.HorizontalPodAutoscalerDetails, 0, len(hpas.Items))
	for i := range hpas.Items {
		result = append(result, s.buildHorizontalPodAutoscalerDetails(&hpas.Items[i]))
	}

	return result, nil
}

func (s *Service) buildHorizontalPodAutoscalerDetails(hpa *autoscalingv2.HorizontalPodAutoscaler) *restypes.HorizontalPodAutoscalerDetails {
	details := &restypes.HorizontalPodAutoscalerDetails{
		Kind:            "HorizontalPodAutoscaler",
		Name:            hpa.Name,
		Namespace:       hpa.Namespace,
		Age:             common.FormatAge(hpa.CreationTimestamp.Time),
		MinReplicas:     hpa.Spec.MinReplicas,
		MaxReplicas:     hpa.Spec.MaxReplicas,
		CurrentReplicas: hpa.Status.CurrentReplicas,
		DesiredReplicas: hpa.Status.DesiredReplicas,
		LastScaleTime:   hpa.Status.LastScaleTime,
		Labels:          hpa.Labels,
		Annotations:     hpa.Annotations,
		ScaleTargetRef: restypes.ScaleTargetReference{
			Kind:       hpa.Spec.ScaleTargetRef.Kind,
			Name:       hpa.Spec.ScaleTargetRef.Name,
			APIVersion: hpa.Spec.ScaleTargetRef.APIVersion,
		},
	}

	for _, metric := range hpa.Spec.Metrics {
		spec := restypes.MetricSpec{Kind: string(metric.Type), Target: map[string]string{}}
		switch metric.Type {
		case autoscalingv2.ResourceMetricSourceType:
			if metric.Resource != nil {
				spec.Target["resource"] = string(metric.Resource.Name)
				switch metric.Resource.Target.Type {
				case autoscalingv2.UtilizationMetricType:
					if metric.Resource.Target.AverageUtilization != nil {
						spec.Target["averageUtilization"] = fmt.Sprintf("%d%%", *metric.Resource.Target.AverageUtilization)
					}
				case autoscalingv2.AverageValueMetricType:
					if metric.Resource.Target.AverageValue != nil {
						spec.Target["averageValue"] = metric.Resource.Target.AverageValue.String()
					}
				}
			}
		case autoscalingv2.PodsMetricSourceType:
			if metric.Pods != nil {
				spec.Target["metric"] = metric.Pods.Metric.Name
				if metric.Pods.Target.AverageValue != nil {
					spec.Target["averageValue"] = metric.Pods.Target.AverageValue.String()
				}
			}
		case autoscalingv2.ObjectMetricSourceType:
			if metric.Object != nil {
				spec.Target["metric"] = metric.Object.Metric.Name
				spec.Target["object"] = fmt.Sprintf("%s/%s", metric.Object.DescribedObject.Kind, metric.Object.DescribedObject.Name)
				if metric.Object.Target.Value != nil {
					spec.Target["value"] = metric.Object.Target.Value.String()
				}
			}
		case autoscalingv2.ExternalMetricSourceType:
			if metric.External != nil {
				spec.Target["metric"] = metric.External.Metric.Name
				if metric.External.Target.Value != nil {
					spec.Target["value"] = metric.External.Target.Value.String()
				}
				if metric.External.Target.AverageValue != nil {
					spec.Target["averageValue"] = metric.External.Target.AverageValue.String()
				}
			}
		case autoscalingv2.ContainerResourceMetricSourceType:
			if metric.ContainerResource != nil {
				spec.Target["resource"] = string(metric.ContainerResource.Name)
				spec.Target["container"] = metric.ContainerResource.Container
				switch metric.ContainerResource.Target.Type {
				case autoscalingv2.UtilizationMetricType:
					if metric.ContainerResource.Target.AverageUtilization != nil {
						spec.Target["averageUtilization"] = fmt.Sprintf("%d%%", *metric.ContainerResource.Target.AverageUtilization)
					}
				case autoscalingv2.AverageValueMetricType:
					if metric.ContainerResource.Target.AverageValue != nil {
						spec.Target["averageValue"] = metric.ContainerResource.Target.AverageValue.String()
					}
				}
			}
		}
		details.Metrics = append(details.Metrics, spec)
	}

	for _, metric := range hpa.Status.CurrentMetrics {
		status := restypes.MetricStatus{Kind: string(metric.Type), Current: map[string]string{}}
		switch metric.Type {
		case autoscalingv2.ResourceMetricSourceType:
			if metric.Resource != nil {
				status.Current["resource"] = string(metric.Resource.Name)
				if metric.Resource.Current.AverageUtilization != nil {
					status.Current["averageUtilization"] = fmt.Sprintf("%d%%", *metric.Resource.Current.AverageUtilization)
				}
				if metric.Resource.Current.AverageValue != nil {
					status.Current["averageValue"] = metric.Resource.Current.AverageValue.String()
				}
			}
		case autoscalingv2.PodsMetricSourceType:
			if metric.Pods != nil {
				status.Current["metric"] = metric.Pods.Metric.Name
				if metric.Pods.Current.AverageValue != nil {
					status.Current["averageValue"] = metric.Pods.Current.AverageValue.String()
				}
			}
		case autoscalingv2.ObjectMetricSourceType:
			if metric.Object != nil {
				status.Current["metric"] = metric.Object.Metric.Name
				status.Current["object"] = fmt.Sprintf("%s/%s", metric.Object.DescribedObject.Kind, metric.Object.DescribedObject.Name)
				if metric.Object.Current.Value != nil {
					status.Current["value"] = metric.Object.Current.Value.String()
				}
			}
		case autoscalingv2.ExternalMetricSourceType:
			if metric.External != nil {
				status.Current["metric"] = metric.External.Metric.Name
				if metric.External.Current.Value != nil {
					status.Current["value"] = metric.External.Current.Value.String()
				}
				if metric.External.Current.AverageValue != nil {
					status.Current["averageValue"] = metric.External.Current.AverageValue.String()
				}
			}
		case autoscalingv2.ContainerResourceMetricSourceType:
			if metric.ContainerResource != nil {
				status.Current["resource"] = string(metric.ContainerResource.Name)
				status.Current["container"] = metric.ContainerResource.Container
				if metric.ContainerResource.Current.AverageUtilization != nil {
					status.Current["averageUtilization"] = fmt.Sprintf("%d%%", *metric.ContainerResource.Current.AverageUtilization)
				}
				if metric.ContainerResource.Current.AverageValue != nil {
					status.Current["averageValue"] = metric.ContainerResource.Current.AverageValue.String()
				}
			}
		}
		details.CurrentMetrics = append(details.CurrentMetrics, status)
	}

	if hpa.Spec.Behavior != nil {
		behavior := &restypes.ScalingBehavior{}
		if hpa.Spec.Behavior.ScaleUp != nil {
			behavior.ScaleUp = buildScalingRules(hpa.Spec.Behavior.ScaleUp)
		}
		if hpa.Spec.Behavior.ScaleDown != nil {
			behavior.ScaleDown = buildScalingRules(hpa.Spec.Behavior.ScaleDown)
		}
		details.Behavior = behavior
	}

	for _, condition := range hpa.Status.Conditions {
		cond := fmt.Sprintf("%s: %s", condition.Type, condition.Status)
		if condition.Reason != "" {
			cond += fmt.Sprintf(" (%s)", condition.Reason)
		}
		if condition.Message != "" {
			cond += fmt.Sprintf(" - %s", condition.Message)
		}
		details.Conditions = append(details.Conditions, cond)
	}

	minReplicas := int32(1)
	if hpa.Spec.MinReplicas != nil {
		minReplicas = *hpa.Spec.MinReplicas
	}
	target := fmt.Sprintf("%s/%s", hpa.Spec.ScaleTargetRef.Kind, hpa.Spec.ScaleTargetRef.Name)
	details.Details = fmt.Sprintf("Target: %s, Replicas: %d/%d/%d", target, minReplicas, hpa.Status.CurrentReplicas, hpa.Spec.MaxReplicas)

	return details
}

func buildScalingRules(rules *autoscalingv2.HPAScalingRules) *restypes.ScalingRules {
	result := &restypes.ScalingRules{
		StabilizationWindowSeconds: rules.StabilizationWindowSeconds,
	}
	if rules.SelectPolicy != nil {
		result.SelectPolicy = string(*rules.SelectPolicy)
	}
	for _, policy := range rules.Policies {
		result.Policies = append(result.Policies, fmt.Sprintf("Type: %s, Value: %d, PeriodSeconds: %d", policy.Type, policy.Value, policy.PeriodSeconds))
	}
	return result
}

func (s *Service) logError(msg string) {
	if s.deps.Logger != nil {
		s.deps.Logger.Error(msg, "ResourceLoader")
	}
}
