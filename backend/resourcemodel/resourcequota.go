package resourcemodel

import (
	"fmt"
	"strconv"

	corev1 "k8s.io/api/core/v1"
)

func BuildResourceQuotaResourceModel(clusterID string, quota *corev1.ResourceQuota) ResourceModel {
	facts := BuildResourceQuotaFacts(quota)
	status := resourceQuotaStatusPresentation(quota, facts)
	return policyResourceModel(clusterID, "", "v1", "ResourceQuota", "resourcequotas", quota.ObjectMeta, status, ResourceFacts{ResourceQuota: &facts})
}

func BuildResourceQuotaFacts(quota *corev1.ResourceQuota) ResourceQuotaFacts {
	facts := ResourceQuotaFacts{
		Hard:           quantityMapStrings(quota.Status.Hard),
		Used:           quantityMapStrings(quota.Status.Used),
		UsedPercentage: quotaUsedPercentages(quota.Status.Used, quota.Status.Hard),
	}
	for _, scope := range quota.Spec.Scopes {
		facts.Scopes = append(facts.Scopes, string(scope))
	}
	if quota.Spec.ScopeSelector != nil {
		facts.ScopeSelector = &ScopeSelectorFacts{}
		for _, expr := range quota.Spec.ScopeSelector.MatchExpressions {
			facts.ScopeSelector.MatchExpressions = append(facts.ScopeSelector.MatchExpressions, ScopeSelectorRequirementFacts{
				ScopeName: string(expr.ScopeName),
				Operator:  string(expr.Operator),
				Values:    append([]string(nil), expr.Values...),
			})
		}
	}
	return facts
}

func resourceQuotaStatusPresentation(quota *corev1.ResourceQuota, facts ResourceQuotaFacts) ResourceStatusPresentation {
	state := strconv.Itoa(len(facts.Hard))
	signals := []ResourceStatusSignal{
		{Type: StatusSignalResourceState, Name: "status.hard.count", Status: state},
		{Type: StatusSignalResourceState, Name: "status.used.count", Status: strconv.Itoa(len(facts.Used))},
	}
	lifecycle := networkLifecycle(quota.ObjectMeta)
	if status, ok := deletingNetworkStatus(quota.ObjectMeta, state, signals, lifecycle); ok {
		return status
	}
	return networkSourceStatus(resourceQuotaSummary(facts), state, "", "ready", signals, lifecycle)
}

func resourceQuotaSummary(facts ResourceQuotaFacts) string {
	if len(facts.Hard) == 0 {
		return "No limits"
	}
	summary := fmt.Sprintf("Hard limits: %d", len(facts.Hard))
	if len(facts.Used) > 0 {
		summary += fmt.Sprintf(", Used: %d", len(facts.Used))
	}
	if len(facts.Scopes) > 0 {
		summary += fmt.Sprintf(", Scopes: %d", len(facts.Scopes))
	}
	return summary
}
