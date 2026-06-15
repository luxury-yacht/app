package resourcemodel

import (
	"fmt"
	"strconv"

	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/util/intstr"
)

func autoscalingResourceModel(
	clusterID, group, version, kind, resource string,
	meta metav1.ObjectMeta,
	status ResourceStatusPresentation,
	facts ResourceFacts,
) ResourceModel {
	return networkResourceModel(clusterID, group, version, kind, resource, ResourceScopeNamespaced, meta, status, facts)
}

func PolicyResourceModel(
	clusterID, group, version, kind, resource string,
	meta metav1.ObjectMeta,
	status ResourceStatusPresentation,
	facts ResourceFacts,
) ResourceModel {
	return networkResourceModel(clusterID, group, version, kind, resource, ResourceScopeNamespaced, meta, status, facts)
}

func hpaScaleTargetLink(clusterID, namespace, apiVersion, kind, name string) ResourceLink {
	if kind == "" || name == "" {
		return displayResourceLink(clusterID, "", "", kind, "", namespace, name)
	}
	gv, err := schema.ParseGroupVersion(apiVersion)
	if err != nil || gv.Version == "" {
		return displayResourceLink(clusterID, "", "", kind, "", namespace, name)
	}
	return namespacedResourceLink(clusterID, gv.Group, gv.Version, kind, "", namespace, name, "")
}

func hpaStatusPresentation(meta metav1.ObjectMeta, facts HorizontalPodAutoscalerFacts) ResourceStatusPresentation {
	signals := []ResourceStatusSignal{
		{Type: StatusSignalResourceState, Name: "status.currentReplicas", Status: strconv.Itoa(int(facts.CurrentReplicas))},
		{Type: StatusSignalResourceState, Name: "status.desiredReplicas", Status: strconv.Itoa(int(facts.DesiredReplicas))},
	}
	for _, condition := range facts.Conditions {
		signals = append(signals, ResourceStatusSignal{
			Type:    StatusSignalCondition,
			Name:    condition.Type,
			Status:  condition.Status,
			Reason:  condition.Reason,
			Message: condition.Message,
		})
	}
	lifecycle := NetworkLifecycle(meta)
	state := strconv.Itoa(int(facts.CurrentReplicas))
	if status, ok := DeletingNetworkStatus(meta, state, signals, lifecycle); ok {
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
			return NetworkSourceStatus(label, condition.Status, condition.Reason, "warning", signals, lifecycle)
		}
	}
	if facts.DesiredReplicas != facts.CurrentReplicas {
		state = fmt.Sprintf("%d/%d", facts.CurrentReplicas, facts.DesiredReplicas)
		return NetworkSourceStatus(fmt.Sprintf("%d/%d replicas", facts.CurrentReplicas, facts.DesiredReplicas), state, "", "warning", signals, lifecycle)
	}
	return NetworkSourceStatus(fmt.Sprintf("%d replicas", facts.CurrentReplicas), state, "", "ready", signals, lifecycle)
}

func hpaConditionFacts(conditions []autoscalingv2.HorizontalPodAutoscalerCondition) []ConditionFacts {
	if len(conditions) == 0 {
		return nil
	}
	facts := make([]ConditionFacts, 0, len(conditions))
	for _, condition := range conditions {
		facts = append(facts, ConditionFacts{
			Type:               string(condition.Type),
			Status:             string(condition.Status),
			Reason:             condition.Reason,
			Message:            condition.Message,
			LastTransitionTime: condition.LastTransitionTime,
		})
	}
	return facts
}

func NewIntOrStringFacts(value intstr.IntOrString) IntOrStringFacts {
	facts := IntOrStringFacts{
		Type:  "String",
		Value: value.String(),
	}
	if value.Type == intstr.Int {
		facts.Type = "Int"
		facts.IntVal = value.IntVal
	} else {
		facts.StrVal = value.StrVal
	}
	return facts
}

func ConditionFactsFromMetav1(conditions []metav1.Condition) []ConditionFacts {
	if len(conditions) == 0 {
		return nil
	}
	facts := make([]ConditionFacts, 0, len(conditions))
	for _, condition := range conditions {
		facts = append(facts, ConditionFacts{
			Type:               condition.Type,
			Status:             string(condition.Status),
			Reason:             condition.Reason,
			Message:            condition.Message,
			LastTransitionTime: condition.LastTransitionTime,
		})
	}
	return facts
}

func quantityMapFacts(values corev1.ResourceList) ResourceQuantityMapFacts {
	if len(values) == 0 {
		return nil
	}
	result := make(ResourceQuantityMapFacts, len(values))
	for name, quantity := range values {
		result[string(name)] = quantity.DeepCopy()
	}
	return result
}

func limitRangeQuantityMap(values corev1.ResourceList) ResourceQuantityMapFacts {
	return quantityMapFacts(values)
}

func quotaUsedPercentages(used, hard corev1.ResourceList) map[string]int {
	if len(used) == 0 || len(hard) == 0 {
		return nil
	}
	result := map[string]int{}
	for resourceName, usedQuantity := range used {
		hardQuantity, ok := hard[resourceName]
		if !ok {
			continue
		}
		if hardValue := hardQuantity.Value(); hardValue > 0 {
			result[string(resourceName)] = int((usedQuantity.Value() * 100) / hardValue)
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
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

func podDisruptedPodLink(clusterID, namespace, name string) ResourceLink {
	return namespacedResourceLink(clusterID, "", "v1", "Pod", "pods", namespace, name, "")
}

func DisruptedPodsFromMap(clusterID, namespace string, pods map[string]metav1.Time) []DisruptedPodFacts {
	if len(pods) == 0 {
		return nil
	}
	result := make([]DisruptedPodFacts, 0, len(pods))
	for name, disruptionTime := range pods {
		result = append(result, DisruptedPodFacts{
			Pod:            podDisruptedPodLink(clusterID, namespace, name),
			DisruptionTime: disruptionTime,
		})
	}
	return result
}
