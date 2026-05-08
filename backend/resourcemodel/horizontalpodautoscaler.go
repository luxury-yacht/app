package resourcemodel

import (
	"fmt"

	autoscalingv1 "k8s.io/api/autoscaling/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
)

func BuildHorizontalPodAutoscalerResourceModel(clusterID string, hpa *autoscalingv2.HorizontalPodAutoscaler) ResourceModel {
	facts := BuildHorizontalPodAutoscalerFacts(clusterID, hpa)
	status := hpaStatusPresentation(hpa.ObjectMeta, facts)
	return autoscalingResourceModel(clusterID, "autoscaling", "v2", "HorizontalPodAutoscaler", "horizontalpodautoscalers", hpa.ObjectMeta, status, ResourceFacts{HorizontalPodAutoscaler: &facts})
}

func BuildHorizontalPodAutoscalerFacts(clusterID string, hpa *autoscalingv2.HorizontalPodAutoscaler) HorizontalPodAutoscalerFacts {
	return HorizontalPodAutoscalerFacts{
		ScaleTarget:     hpaScaleTargetLink(clusterID, hpa.Namespace, hpa.Spec.ScaleTargetRef.APIVersion, hpa.Spec.ScaleTargetRef.Kind, hpa.Spec.ScaleTargetRef.Name),
		MinReplicas:     hpa.Spec.MinReplicas,
		MaxReplicas:     hpa.Spec.MaxReplicas,
		CurrentReplicas: hpa.Status.CurrentReplicas,
		DesiredReplicas: hpa.Status.DesiredReplicas,
		Metrics:         hpaMetricFacts(hpa.Spec.Metrics),
		CurrentMetrics:  hpaCurrentMetricFacts(hpa.Status.CurrentMetrics),
		Behavior:        hpaBehaviorFacts(hpa.Spec.Behavior),
		Conditions:      hpaConditionFacts(hpa.Status.Conditions),
		LastScaleTime:   hpa.Status.LastScaleTime,
	}
}

func BuildHorizontalPodAutoscalerV1ResourceModel(clusterID string, hpa *autoscalingv1.HorizontalPodAutoscaler) ResourceModel {
	facts := BuildHorizontalPodAutoscalerV1Facts(clusterID, hpa)
	status := hpaStatusPresentation(hpa.ObjectMeta, facts)
	return autoscalingResourceModel(clusterID, "autoscaling", "v1", "HorizontalPodAutoscaler", "horizontalpodautoscalers", hpa.ObjectMeta, status, ResourceFacts{HorizontalPodAutoscaler: &facts})
}

func BuildHorizontalPodAutoscalerV1Facts(clusterID string, hpa *autoscalingv1.HorizontalPodAutoscaler) HorizontalPodAutoscalerFacts {
	facts := HorizontalPodAutoscalerFacts{
		ScaleTarget:     hpaScaleTargetLink(clusterID, hpa.Namespace, hpa.Spec.ScaleTargetRef.APIVersion, hpa.Spec.ScaleTargetRef.Kind, hpa.Spec.ScaleTargetRef.Name),
		MinReplicas:     hpa.Spec.MinReplicas,
		MaxReplicas:     hpa.Spec.MaxReplicas,
		CurrentReplicas: hpa.Status.CurrentReplicas,
		DesiredReplicas: hpa.Status.DesiredReplicas,
		LastScaleTime:   hpa.Status.LastScaleTime,
	}
	if hpa.Spec.TargetCPUUtilizationPercentage != nil {
		facts.Metrics = []MetricFacts{{
			Kind: "Resource",
			Target: map[string]string{
				"resource":           "cpu",
				"averageUtilization": fmt.Sprintf("%d%%", *hpa.Spec.TargetCPUUtilizationPercentage),
			},
		}}
	}
	if hpa.Status.CurrentCPUUtilizationPercentage != nil {
		facts.CurrentMetrics = []MetricStatusFacts{{
			Kind: "Resource",
			Current: map[string]string{
				"resource":           "cpu",
				"averageUtilization": fmt.Sprintf("%d%%", *hpa.Status.CurrentCPUUtilizationPercentage),
			},
		}}
	}
	return facts
}

func hpaMetricFacts(metrics []autoscalingv2.MetricSpec) []MetricFacts {
	if len(metrics) == 0 {
		return nil
	}
	facts := make([]MetricFacts, 0, len(metrics))
	for _, metric := range metrics {
		spec := MetricFacts{Kind: string(metric.Type), Target: map[string]string{}}
		switch metric.Type {
		case autoscalingv2.ResourceMetricSourceType:
			if metric.Resource != nil {
				spec.Target["resource"] = string(metric.Resource.Name)
				addMetricTarget(spec.Target, metric.Resource.Target)
			}
		case autoscalingv2.PodsMetricSourceType:
			if metric.Pods != nil {
				spec.Target["metric"] = metric.Pods.Metric.Name
				addMetricTarget(spec.Target, metric.Pods.Target)
			}
		case autoscalingv2.ObjectMetricSourceType:
			if metric.Object != nil {
				spec.Target["metric"] = metric.Object.Metric.Name
				spec.Target["object"] = objectMetricTargetName(metric.Object.DescribedObject.APIVersion, metric.Object.DescribedObject.Kind, metric.Object.DescribedObject.Name)
				addMetricTarget(spec.Target, metric.Object.Target)
			}
		case autoscalingv2.ExternalMetricSourceType:
			if metric.External != nil {
				spec.Target["metric"] = metric.External.Metric.Name
				addMetricTarget(spec.Target, metric.External.Target)
			}
		case autoscalingv2.ContainerResourceMetricSourceType:
			if metric.ContainerResource != nil {
				spec.Target["resource"] = string(metric.ContainerResource.Name)
				spec.Target["container"] = metric.ContainerResource.Container
				addMetricTarget(spec.Target, metric.ContainerResource.Target)
			}
		}
		if len(spec.Target) == 0 {
			spec.Target = nil
		}
		facts = append(facts, spec)
	}
	return facts
}

func hpaCurrentMetricFacts(metrics []autoscalingv2.MetricStatus) []MetricStatusFacts {
	if len(metrics) == 0 {
		return nil
	}
	facts := make([]MetricStatusFacts, 0, len(metrics))
	for _, metric := range metrics {
		status := MetricStatusFacts{Kind: string(metric.Type), Current: map[string]string{}}
		switch metric.Type {
		case autoscalingv2.ResourceMetricSourceType:
			if metric.Resource != nil {
				status.Current["resource"] = string(metric.Resource.Name)
				addMetricValueStatus(status.Current, metric.Resource.Current)
			}
		case autoscalingv2.PodsMetricSourceType:
			if metric.Pods != nil {
				status.Current["metric"] = metric.Pods.Metric.Name
				addMetricValueStatus(status.Current, metric.Pods.Current)
			}
		case autoscalingv2.ObjectMetricSourceType:
			if metric.Object != nil {
				status.Current["metric"] = metric.Object.Metric.Name
				status.Current["object"] = objectMetricTargetName(metric.Object.DescribedObject.APIVersion, metric.Object.DescribedObject.Kind, metric.Object.DescribedObject.Name)
				addMetricValueStatus(status.Current, metric.Object.Current)
			}
		case autoscalingv2.ExternalMetricSourceType:
			if metric.External != nil {
				status.Current["metric"] = metric.External.Metric.Name
				addMetricValueStatus(status.Current, metric.External.Current)
			}
		case autoscalingv2.ContainerResourceMetricSourceType:
			if metric.ContainerResource != nil {
				status.Current["resource"] = string(metric.ContainerResource.Name)
				status.Current["container"] = metric.ContainerResource.Container
				addMetricValueStatus(status.Current, metric.ContainerResource.Current)
			}
		}
		if len(status.Current) == 0 {
			status.Current = nil
		}
		facts = append(facts, status)
	}
	return facts
}

func addMetricTarget(target map[string]string, metric autoscalingv2.MetricTarget) {
	switch metric.Type {
	case autoscalingv2.UtilizationMetricType:
		if metric.AverageUtilization != nil {
			target["averageUtilization"] = fmt.Sprintf("%d%%", *metric.AverageUtilization)
		}
	case autoscalingv2.AverageValueMetricType:
		if value := metricTargetValue(metric.AverageValue); value != "" {
			target["averageValue"] = value
		}
	case autoscalingv2.ValueMetricType:
		if value := metricTargetValue(metric.Value); value != "" {
			target["value"] = value
		}
	}
}

func addMetricValueStatus(current map[string]string, metric autoscalingv2.MetricValueStatus) {
	if metric.AverageUtilization != nil {
		current["averageUtilization"] = fmt.Sprintf("%d%%", *metric.AverageUtilization)
	}
	if value := metricTargetValue(metric.AverageValue); value != "" {
		current["averageValue"] = value
	}
	if value := metricTargetValue(metric.Value); value != "" {
		current["value"] = value
	}
}

func hpaBehaviorFacts(behavior *autoscalingv2.HorizontalPodAutoscalerBehavior) *ScalingBehaviorFacts {
	if behavior == nil {
		return nil
	}
	return &ScalingBehaviorFacts{
		ScaleUp:   hpaScalingRulesFacts(behavior.ScaleUp),
		ScaleDown: hpaScalingRulesFacts(behavior.ScaleDown),
	}
}

func hpaScalingRulesFacts(rules *autoscalingv2.HPAScalingRules) *ScalingRulesFacts {
	if rules == nil {
		return nil
	}
	facts := &ScalingRulesFacts{
		StabilizationWindowSeconds: rules.StabilizationWindowSeconds,
	}
	if rules.SelectPolicy != nil {
		facts.SelectPolicy = string(*rules.SelectPolicy)
	}
	for _, policy := range rules.Policies {
		facts.Policies = append(facts.Policies, fmt.Sprintf("Type: %s, Value: %d, PeriodSeconds: %d", policy.Type, policy.Value, policy.PeriodSeconds))
	}
	return facts
}
