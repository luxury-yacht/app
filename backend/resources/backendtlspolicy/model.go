/*
 * backend/resources/backendtlspolicy/model.go
 *
 * BackendTLSPolicy resource model + facts. Shared gateway helpers live in resourcemodel.
 */

package backendtlspolicy

import (
	"github.com/luxury-yacht/app/backend/resourcemodel"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// BuildResourceModel builds the shared resource model for a BackendTLSPolicy.
func BuildResourceModel(clusterID string, policy *gatewayv1.BackendTLSPolicy) resourcemodel.ResourceModel {
	facts := BuildFacts(clusterID, policy)
	status := buildStatusPresentation(policy, facts)
	return resourcemodel.GatewayAPIResourceModel(clusterID, "BackendTLSPolicy", "backendtlspolicies", resourcemodel.ResourceScopeNamespaced, policy.ObjectMeta, status, resourcemodel.ResourceFacts{})
}

// BuildFacts projects a BackendTLSPolicy into its semantic facts.
func BuildFacts(clusterID string, policy *gatewayv1.BackendTLSPolicy) Facts {
	conditions := resourcemodel.GatewayConditionFacts(resourcemodel.GatewayBackendTLSConditions(policy.Status.Ancestors))
	facts := Facts{
		Conditions: conditions,
		Summary:    resourcemodel.GatewayConditionsSummary(conditions),
	}
	for _, targetRef := range policy.Spec.TargetRefs {
		facts.TargetRefs = append(facts.TargetRefs, resourcemodel.GatewayPolicyTargetRefLink(clusterID, policy.Namespace, targetRef))
	}
	return facts
}

func buildStatusPresentation(policy *gatewayv1.BackendTLSPolicy, facts Facts) resourcemodel.ResourceStatusPresentation {
	state := resourcemodel.GatewayCountState(len(facts.TargetRefs))
	label := resourcemodel.CountLabel(len(facts.TargetRefs), "target", "targets")
	return resourcemodel.GatewayStatusFromConditions(policy.ObjectMeta, state, label, facts.Conditions)
}
