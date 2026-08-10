/*
 * backend/resources/hpa/model.go
 *
 * HorizontalPodAutoscaler resource model: the single definition of an HPA's
 * intrinsic fields + status presentation, for both the v2 (primary) and v1 APIs.
 * Detail/object-map projections use v2; the snapshot streaming summary uses v1.
 * Shared model helpers are reused from resourcemodel (exported network base).
 */

package hpa

import (
	"fmt"
	"strconv"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// BuildResourceModel builds the v2 HorizontalPodAutoscaler resource model. Facts are
// owned by this package (hpa.Facts); callers needing facts use BuildFacts.
func BuildResourceModel(clusterID string, h *autoscalingv2.HorizontalPodAutoscaler) resourcemodel.ResourceModel {
	facts := BuildFacts(clusterID, h)
	status := statusPresentation(h.ObjectMeta, facts)
	return resourcemodel.KubernetesResourceModel(clusterID, Identity, h.ObjectMeta, status, resourcemodel.ResourceFacts{})
}

// BuildFacts extracts the HPA facts from a v2 object.
func BuildFacts(clusterID string, h *autoscalingv2.HorizontalPodAutoscaler) Facts {
	return Facts{
		ScaleTarget:     scaleTargetLink(clusterID, h.Namespace, h.Spec.ScaleTargetRef.APIVersion, h.Spec.ScaleTargetRef.Kind, h.Spec.ScaleTargetRef.Name),
		MinReplicas:     h.Spec.MinReplicas,
		MaxReplicas:     h.Spec.MaxReplicas,
		CurrentReplicas: h.Status.CurrentReplicas,
		DesiredReplicas: h.Status.DesiredReplicas,
		Metrics:         metricFacts(h.Spec.Metrics),
		CurrentMetrics:  currentMetricFacts(h.Status.CurrentMetrics),
		Behavior:        behaviorFacts(h.Spec.Behavior),
		Conditions:      conditionFacts(h.Status.Conditions),
		LastScaleTime:   h.Status.LastScaleTime,
	}
}

// BuildV1Facts extracts the HPA facts from a v1 object. The v1 API only carries the
// legacy single CPU-utilization target; it is projected into the same metric facts.
func BuildV1Facts(clusterID string, h *autoscalingv1.HorizontalPodAutoscaler) Facts {
	facts := Facts{
		ScaleTarget:     scaleTargetLink(clusterID, h.Namespace, h.Spec.ScaleTargetRef.APIVersion, h.Spec.ScaleTargetRef.Kind, h.Spec.ScaleTargetRef.Name),
		MinReplicas:     h.Spec.MinReplicas,
		MaxReplicas:     h.Spec.MaxReplicas,
		CurrentReplicas: h.Status.CurrentReplicas,
		DesiredReplicas: h.Status.DesiredReplicas,
		LastScaleTime:   h.Status.LastScaleTime,
	}
	if h.Spec.TargetCPUUtilizationPercentage != nil {
		facts.Metrics = []MetricFacts{{
			Kind: "Resource",
			Target: map[string]string{
				"resource":           "cpu",
				"averageUtilization": fmt.Sprintf("%d%%", *h.Spec.TargetCPUUtilizationPercentage),
			},
		}}
	}
	if h.Status.CurrentCPUUtilizationPercentage != nil {
		facts.CurrentMetrics = []MetricStatusFacts{{
			Kind: "Resource",
			Current: map[string]string{
				"resource":           "cpu",
				"averageUtilization": fmt.Sprintf("%d%%", *h.Status.CurrentCPUUtilizationPercentage),
			},
		}}
	}
	return facts
}

func scaleTargetLink(clusterID, namespace, apiVersion, kind, name string) resourcemodel.ResourceLink {
	if kind == "" || name == "" {
		return resourcemodel.NewDisplayResourceLink(clusterID, "", "", kind, "", namespace, name)
	}
	gv, err := schema.ParseGroupVersion(apiVersion)
	if err != nil || gv.Version == "" {
		return resourcemodel.NewDisplayResourceLink(clusterID, "", "", kind, "", namespace, name)
	}
	return resourcemodel.NewNamespacedResourceLink(resourcemodel.ResourceRef{ClusterID: clusterID, Group: gv.Group, Version: gv.Version, Kind: kind, Resource: "", Namespace: namespace, Name: name, UID: ""})
}

func statusPresentation(meta metav1.ObjectMeta, facts Facts) resourcemodel.ResourceStatusPresentation {
	signals := []resourcemodel.ResourceStatusSignal{
		{Type: resourcemodel.StatusSignalResourceState, Name: "status.currentReplicas", Status: strconv.Itoa(int(facts.CurrentReplicas))},
		{Type: resourcemodel.StatusSignalResourceState, Name: "status.desiredReplicas", Status: strconv.Itoa(int(facts.DesiredReplicas))},
	}
	for _, condition := range facts.Conditions {
		signals = append(signals, resourcemodel.ResourceStatusSignal{
			Type:    resourcemodel.StatusSignalCondition,
			Name:    condition.Type,
			Status:  condition.Status,
			Reason:  condition.Reason,
			Message: condition.Message,
		})
	}
	lifecycle := resourcemodel.ObjectLifecycle(meta)
	state := strconv.Itoa(int(facts.CurrentReplicas))
	if status, ok := resourcemodel.DeletingObjectStatus(meta, state, signals, lifecycle); ok {
		return status
	}
	for _, condition := range facts.Conditions {
		if condition.Status != string(corev1.ConditionFalse) {
			continue
		}
		switch condition.Type {
		case string(autoscalingv2.AbleToScale), string(autoscalingv2.ScalingActive):
			label := condition.Type
			if condition.Reason != "" {
				label = fmt.Sprintf("%s: %s", condition.Type, condition.Reason)
			}
			return resourcemodel.ObjectSourceStatus(label, condition.Status, condition.Reason, "", "warning", signals, lifecycle)
		}
	}
	if facts.DesiredReplicas != facts.CurrentReplicas {
		state = fmt.Sprintf("%d/%d", facts.CurrentReplicas, facts.DesiredReplicas)
		return resourcemodel.ObjectSourceStatus(fmt.Sprintf("%d/%d replicas", facts.CurrentReplicas, facts.DesiredReplicas), state, "", "", "warning", signals, lifecycle)
	}
	return resourcemodel.ObjectSourceStatus(fmt.Sprintf("%d replicas", facts.CurrentReplicas), state, "", "", "ready", signals, lifecycle)
}

func metricFacts(metrics []autoscalingv2.MetricSpec) []MetricFacts {
	if len(metrics) == 0 {
		return nil
	}
	facts := make([]MetricFacts, 0, len(metrics))
	for _, metric := range metrics {
		facts = append(facts, metricSpecFacts(metric))
	}
	return facts
}

func metricSpecFacts(metric autoscalingv2.MetricSpec) MetricFacts {
	target := make(map[string]string)
	switch metric.Type {
	case autoscalingv2.ResourceMetricSourceType:
		addResourceMetricSpec(target, metric.Resource)
	case autoscalingv2.PodsMetricSourceType:
		addPodsMetricSpec(target, metric.Pods)
	case autoscalingv2.ObjectMetricSourceType:
		addObjectMetricSpec(target, metric.Object)
	case autoscalingv2.ExternalMetricSourceType:
		addExternalMetricSpec(target, metric.External)
	case autoscalingv2.ContainerResourceMetricSourceType:
		addContainerResourceMetricSpec(target, metric.ContainerResource)
	}
	if len(target) == 0 {
		target = nil
	}
	return MetricFacts{Kind: string(metric.Type), Target: target}
}

func addResourceMetricSpec(target map[string]string, source *autoscalingv2.ResourceMetricSource) {
	if source != nil {
		target["resource"] = string(source.Name)
		addMetricTarget(target, source.Target)
	}
}

func addPodsMetricSpec(target map[string]string, source *autoscalingv2.PodsMetricSource) {
	if source != nil {
		target["metric"] = source.Metric.Name
		addMetricTarget(target, source.Target)
	}
}

func addObjectMetricSpec(target map[string]string, source *autoscalingv2.ObjectMetricSource) {
	if source != nil {
		target["metric"] = source.Metric.Name
		target["object"] = objectMetricTargetName(source.DescribedObject.APIVersion, source.DescribedObject.Kind, source.DescribedObject.Name)
		addMetricTarget(target, source.Target)
	}
}

func addExternalMetricSpec(target map[string]string, source *autoscalingv2.ExternalMetricSource) {
	if source != nil {
		target["metric"] = source.Metric.Name
		addMetricTarget(target, source.Target)
	}
}

func addContainerResourceMetricSpec(target map[string]string, source *autoscalingv2.ContainerResourceMetricSource) {
	if source != nil {
		target["resource"] = string(source.Name)
		target["container"] = source.Container
		addMetricTarget(target, source.Target)
	}
}

func currentMetricFacts(metrics []autoscalingv2.MetricStatus) []MetricStatusFacts {
	if len(metrics) == 0 {
		return nil
	}
	facts := make([]MetricStatusFacts, 0, len(metrics))
	for _, metric := range metrics {
		facts = append(facts, metricStatusFacts(metric))
	}
	return facts
}

func metricStatusFacts(metric autoscalingv2.MetricStatus) MetricStatusFacts {
	current := make(map[string]string)
	switch metric.Type {
	case autoscalingv2.ResourceMetricSourceType:
		addResourceMetricStatus(current, metric.Resource)
	case autoscalingv2.PodsMetricSourceType:
		addPodsMetricStatus(current, metric.Pods)
	case autoscalingv2.ObjectMetricSourceType:
		addObjectMetricStatus(current, metric.Object)
	case autoscalingv2.ExternalMetricSourceType:
		addExternalMetricStatus(current, metric.External)
	case autoscalingv2.ContainerResourceMetricSourceType:
		addContainerResourceMetricStatus(current, metric.ContainerResource)
	}
	if len(current) == 0 {
		current = nil
	}
	return MetricStatusFacts{Kind: string(metric.Type), Current: current}
}

func addResourceMetricStatus(current map[string]string, source *autoscalingv2.ResourceMetricStatus) {
	if source != nil {
		current["resource"] = string(source.Name)
		addMetricValueStatus(current, source.Current)
	}
}

func addPodsMetricStatus(current map[string]string, source *autoscalingv2.PodsMetricStatus) {
	if source != nil {
		current["metric"] = source.Metric.Name
		addMetricValueStatus(current, source.Current)
	}
}

func addObjectMetricStatus(current map[string]string, source *autoscalingv2.ObjectMetricStatus) {
	if source != nil {
		current["metric"] = source.Metric.Name
		current["object"] = objectMetricTargetName(source.DescribedObject.APIVersion, source.DescribedObject.Kind, source.DescribedObject.Name)
		addMetricValueStatus(current, source.Current)
	}
}

func addExternalMetricStatus(current map[string]string, source *autoscalingv2.ExternalMetricStatus) {
	if source != nil {
		current["metric"] = source.Metric.Name
		addMetricValueStatus(current, source.Current)
	}
}

func addContainerResourceMetricStatus(current map[string]string, source *autoscalingv2.ContainerResourceMetricStatus) {
	if source != nil {
		current["resource"] = string(source.Name)
		current["container"] = source.Container
		addMetricValueStatus(current, source.Current)
	}
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

func behaviorFacts(behavior *autoscalingv2.HorizontalPodAutoscalerBehavior) *ScalingBehaviorFacts {
	if behavior == nil {
		return nil
	}
	return &ScalingBehaviorFacts{
		ScaleUp:   scalingRulesFacts(behavior.ScaleUp),
		ScaleDown: scalingRulesFacts(behavior.ScaleDown),
	}
}

func scalingRulesFacts(rules *autoscalingv2.HPAScalingRules) *ScalingRulesFacts {
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

func conditionFacts(conditions []autoscalingv2.HorizontalPodAutoscalerCondition) []resourcemodel.ConditionFacts {
	if len(conditions) == 0 {
		return nil
	}
	facts := make([]resourcemodel.ConditionFacts, 0, len(conditions))
	for _, condition := range conditions {
		facts = append(facts, resourcemodel.ConditionFacts{
			Type:               string(condition.Type),
			Status:             string(condition.Status),
			Reason:             condition.Reason,
			Message:            condition.Message,
			LastTransitionTime: condition.LastTransitionTime,
		})
	}
	return facts
}

func metricTargetValue(quantity *resource.Quantity) string {
	if quantity == nil {
		return ""
	}
	return quantity.String()
}

func objectMetricTargetName(apiVersion, kind, name string) string {
	if apiVersion == "" {
		return fmt.Sprintf("%s/%s", kind, name)
	}
	return fmt.Sprintf("%s %s/%s", apiVersion, kind, name)
}
