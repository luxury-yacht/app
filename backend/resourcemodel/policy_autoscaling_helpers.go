package resourcemodel

import (
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	"math"
)

func PolicyResourceModel(
	clusterID, group, version, kind, resource string,
	meta metav1.ObjectMeta,
	status ResourceStatusPresentation,
	facts ResourceFacts,
) ResourceModel {
	return NetworkResourceModel(clusterID, group, version, kind, resource, ResourceScopeNamespaced, meta, status, facts)
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

func QuantityMapFacts(values corev1.ResourceList) ResourceQuantityMapFacts {
	if len(values) == 0 {
		return nil
	}
	result := make(ResourceQuantityMapFacts, len(values))
	for name, quantity := range values {
		result[string(name)] = quantity.DeepCopy()
	}
	return result
}

func QuotaUsedPercentages(used, hard corev1.ResourceList) map[string]int {
	if len(used) == 0 || len(hard) == 0 {
		return nil
	}
	result := map[string]int{}
	for resourceName, usedQuantity := range used {
		hardQuantity, ok := hard[resourceName]
		if !ok {
			continue
		}
		if hardValue := hardQuantity.AsApproximateFloat64(); hardValue > 0 {
			usedValue := usedQuantity.AsApproximateFloat64()
			result[string(resourceName)] = int(math.Floor((usedValue/hardValue)*100 + 1e-9))
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
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
