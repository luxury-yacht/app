package resourcemodel

import (
	"fmt"
	"strconv"

	corev1 "k8s.io/api/core/v1"
)

func BuildLimitRangeResourceModel(clusterID string, limitRange *corev1.LimitRange) ResourceModel {
	facts := BuildLimitRangeFacts(limitRange)
	status := limitRangeStatusPresentation(limitRange, facts)
	return PolicyResourceModel(clusterID, "", "v1", "LimitRange", "limitranges", limitRange.ObjectMeta, status, ResourceFacts{LimitRange: &facts})
}

func BuildLimitRangeFacts(limitRange *corev1.LimitRange) LimitRangeFacts {
	facts := LimitRangeFacts{}
	for _, limit := range limitRange.Spec.Limits {
		facts.Limits = append(facts.Limits, LimitRangeItemFacts{
			Kind:                 string(limit.Type),
			Max:                  limitRangeQuantityMap(limit.Max),
			Min:                  limitRangeQuantityMap(limit.Min),
			Default:              limitRangeQuantityMap(limit.Default),
			DefaultRequest:       limitRangeQuantityMap(limit.DefaultRequest),
			MaxLimitRequestRatio: limitRangeQuantityMap(limit.MaxLimitRequestRatio),
		})
	}
	return facts
}

func limitRangeStatusPresentation(limitRange *corev1.LimitRange, facts LimitRangeFacts) ResourceStatusPresentation {
	state := strconv.Itoa(len(facts.Limits))
	signals := []ResourceStatusSignal{{
		Type:   StatusSignalResourceState,
		Name:   "spec.limits.count",
		Status: state,
	}}
	lifecycle := NetworkLifecycle(limitRange.ObjectMeta)
	if status, ok := DeletingNetworkStatus(limitRange.ObjectMeta, state, signals, lifecycle); ok {
		return status
	}
	return NetworkSourceStatus(limitRangeSummary(facts), state, "", "ready", signals, lifecycle)
}

func limitRangeSummary(facts LimitRangeFacts) string {
	summary := fmt.Sprintf("%d limit(s)", len(facts.Limits))
	if len(facts.Limits) > 0 {
		summary += fmt.Sprintf(" - Type: %s", facts.Limits[0].Kind)
	}
	return summary
}
