/*
 * backend/resources/resourcequota/model.go
 *
 * ResourceQuota resource model: the single definition of a ResourceQuota's
 * intrinsic fields + status presentation. Shared model + quantity helpers are
 * reused from resourcemodel (exported base).
 */

package resourcequota

import (
	"fmt"
	"strconv"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	corev1 "k8s.io/api/core/v1"
)

// BuildResourceModel builds the ResourceQuota resource model. Facts are owned by
// this package; the shared ResourceModel carries identity + status.
func BuildResourceModel(clusterID string, quota *corev1.ResourceQuota) resourcemodel.ResourceModel {
	facts := BuildFacts(quota)
	status := statusPresentation(quota, facts)
	return resourcemodel.PolicyResourceModel(clusterID, "", "v1", "ResourceQuota", "resourcequotas", quota.ObjectMeta, status, resourcemodel.ResourceFacts{})
}

// BuildFacts extracts the ResourceQuota facts from the raw object.
func BuildFacts(quota *corev1.ResourceQuota) Facts {
	facts := Facts{
		Hard:           resourcemodel.QuantityMapFacts(quota.Status.Hard),
		Used:           resourcemodel.QuantityMapFacts(quota.Status.Used),
		UsedPercentage: resourcemodel.QuotaUsedPercentages(quota.Status.Used, quota.Status.Hard),
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

func statusPresentation(quota *corev1.ResourceQuota, facts Facts) resourcemodel.ResourceStatusPresentation {
	state := strconv.Itoa(len(facts.Hard))
	signals := []resourcemodel.ResourceStatusSignal{
		{Type: resourcemodel.StatusSignalResourceState, Name: "status.hard.count", Status: state},
		{Type: resourcemodel.StatusSignalResourceState, Name: "status.used.count", Status: strconv.Itoa(len(facts.Used))},
	}
	lifecycle := resourcemodel.ObjectLifecycle(quota.ObjectMeta)
	if status, ok := resourcemodel.DeletingObjectStatus(quota.ObjectMeta, state, signals, lifecycle); ok {
		return status
	}
	return resourcemodel.ObjectSourceStatus(summary(facts), state, "", "", "ready", signals, lifecycle)
}

func summary(facts Facts) string {
	if len(facts.Hard) == 0 {
		return "No limits"
	}
	out := fmt.Sprintf("Hard limits: %d", len(facts.Hard))
	if len(facts.Used) > 0 {
		out += fmt.Sprintf(", Used: %d", len(facts.Used))
	}
	if len(facts.Scopes) > 0 {
		out += fmt.Sprintf(", Scopes: %d", len(facts.Scopes))
	}
	return out
}
