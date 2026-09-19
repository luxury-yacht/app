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
	status := buildStatusPresentation(policy)
	return resourcemodel.KubernetesResourceModel(clusterID, Identity, policy.ObjectMeta, status)
}

// BuildFacts projects a BackendTLSPolicy into its semantic facts.
func BuildFacts(clusterID string, policy *gatewayv1.BackendTLSPolicy) Facts {
	conditions := resourcemodel.GatewayConditionFacts(resourcemodel.GatewayBackendTLSConditions(policy.Status.Ancestors))
	facts := Facts{
		Conditions: conditions,
		Summary:    resourcemodel.GatewayConditionsSummary(conditions),
	}
	facts.TargetRefs = targetLinks(clusterID, policy)
	return facts
}

func buildStatusPresentation(policy *gatewayv1.BackendTLSPolicy) resourcemodel.ResourceStatusPresentation {
	state := resourcemodel.GatewayCountState(len(policy.Spec.TargetRefs))
	label := resourcemodel.CountLabel(len(policy.Spec.TargetRefs), "target", "targets")
	return resourcemodel.GatewayStatusFromConditions(policy.ObjectMeta, state, label, resourcemodel.GatewayConditionFacts(resourcemodel.GatewayBackendTLSConditions(policy.Status.Ancestors)))
}

func targetLinks(clusterID string, policy *gatewayv1.BackendTLSPolicy) []resourcemodel.ResourceLink {
	var links []resourcemodel.ResourceLink
	for _, targetRef := range policy.Spec.TargetRefs {
		links = append(links, resourcemodel.GatewayPolicyTargetRefLink(clusterID, policy.Namespace, targetRef))
	}
	return links
}
