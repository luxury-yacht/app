package resourcemodel

import gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"

func BuildBackendTLSPolicyResourceModel(clusterID string, policy *gatewayv1.BackendTLSPolicy) ResourceModel {
	facts := BuildBackendTLSPolicyFacts(clusterID, policy)
	status := BuildBackendTLSPolicyStatusPresentation(policy, facts)
	return gatewayAPIResourceModel(clusterID, "BackendTLSPolicy", "backendtlspolicies", ResourceScopeNamespaced, policy.ObjectMeta, status, ResourceFacts{BackendTLSPolicy: &facts})
}

func BuildBackendTLSPolicyFacts(clusterID string, policy *gatewayv1.BackendTLSPolicy) BackendTLSPolicyFacts {
	conditions := gatewayConditionFacts(gatewayBackendTLSConditions(policy.Status.Ancestors))
	facts := BackendTLSPolicyFacts{
		Conditions: conditions,
		Summary:    gatewayConditionsSummary(conditions),
	}
	for _, targetRef := range policy.Spec.TargetRefs {
		facts.TargetRefs = append(facts.TargetRefs, gatewayPolicyTargetRefLink(clusterID, policy.Namespace, targetRef))
	}
	return facts
}

func BuildBackendTLSPolicyStatusPresentation(policy *gatewayv1.BackendTLSPolicy, facts BackendTLSPolicyFacts) ResourceStatusPresentation {
	state := gatewayCountState(len(facts.TargetRefs))
	label := CountLabel(len(facts.TargetRefs), "target", "targets")
	return gatewayStatusFromConditions(policy.ObjectMeta, state, label, facts.Conditions)
}
