package resourcemodel

import gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"

func BuildReferenceGrantResourceModel(clusterID string, grant *gatewayv1.ReferenceGrant) ResourceModel {
	facts := BuildReferenceGrantFacts(clusterID, grant)
	status := BuildReferenceGrantStatusPresentation(grant, facts)
	return gatewayAPIResourceModel(clusterID, "ReferenceGrant", "referencegrants", ResourceScopeNamespaced, grant.ObjectMeta, status, ResourceFacts{ReferenceGrant: &facts})
}

func BuildReferenceGrantFacts(clusterID string, grant *gatewayv1.ReferenceGrant) ReferenceGrantFacts {
	facts := ReferenceGrantFacts{}
	for _, from := range grant.Spec.From {
		facts.From = append(facts.From, ReferenceGrantFromFacts{
			Group:     string(from.Group),
			Kind:      string(from.Kind),
			Namespace: string(from.Namespace),
		})
	}
	for _, to := range grant.Spec.To {
		facts.To = append(facts.To, gatewayReferenceGrantToLink(clusterID, grant.Namespace, to))
	}
	return facts
}

func BuildReferenceGrantStatusPresentation(grant *gatewayv1.ReferenceGrant, facts ReferenceGrantFacts) ResourceStatusPresentation {
	state := gatewayCountState(len(facts.To))
	signals := []ResourceStatusSignal{
		{Type: StatusSignalResourceState, Name: "spec.from", Status: gatewayCountState(len(facts.From))},
		{Type: StatusSignalResourceState, Name: "spec.to", Status: state},
	}
	lifecycle := networkLifecycle(grant.ObjectMeta)
	if status, ok := deletingNetworkStatus(grant.ObjectMeta, state, signals, lifecycle); ok {
		return status
	}
	return networkSourceStatus(referenceGrantLabel(facts), state, "", "ready", signals, lifecycle)
}

func referenceGrantLabel(facts ReferenceGrantFacts) string {
	return countLabel(len(facts.From), "from", "from") + ", " + countLabel(len(facts.To), "to", "to")
}
