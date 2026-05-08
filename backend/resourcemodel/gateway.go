package resourcemodel

import gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"

func BuildGatewayResourceModel(clusterID string, gateway *gatewayv1.Gateway) ResourceModel {
	facts := BuildGatewayFacts(clusterID, gateway)
	status := BuildGatewayStatusPresentation(gateway, facts)
	return gatewayAPIResourceModel(clusterID, "Gateway", "gateways", ResourceScopeNamespaced, gateway.ObjectMeta, status, ResourceFacts{Gateway: &facts})
}

func BuildGatewayFacts(clusterID string, gateway *gatewayv1.Gateway) GatewayFacts {
	conditions := gatewayConditionFacts(gateway.Status.Conditions)
	class := gatewayClassLink(clusterID, gateway.Spec.GatewayClassName)
	facts := GatewayFacts{
		Class:      &class,
		Addresses:  gatewayAddressValues(gateway.Status.Addresses),
		Listeners:  gatewayListenerFactsFromGateway(gateway.Spec.Listeners, gateway.Status.Listeners),
		Conditions: conditions,
		Summary:    gatewayConditionsSummary(conditions),
	}
	return facts
}

func BuildGatewayStatusPresentation(gateway *gatewayv1.Gateway, facts GatewayFacts) ResourceStatusPresentation {
	state := gatewayCountState(len(facts.Addresses))
	label := countLabel(len(facts.Listeners), "listener", "listeners")
	return gatewayStatusFromConditions(gateway.ObjectMeta, state, label, facts.Conditions)
}

func gatewayListenerFactsFromGateway(spec []gatewayv1.Listener, status []gatewayv1.ListenerStatus) []GatewayListenerFacts {
	statusByName := map[string]gatewayListenerStatusFacts{}
	for _, listenerStatus := range status {
		statusByName[string(listenerStatus.Name)] = gatewayListenerStatusFacts{
			attachedRoutes: int32(listenerStatus.AttachedRoutes),
			conditions:     listenerStatus.Conditions,
		}
	}
	facts := make([]GatewayListenerFacts, 0, len(spec))
	for _, listener := range spec {
		hostname := ""
		if listener.Hostname != nil {
			hostname = string(*listener.Hostname)
		}
		facts = append(facts, gatewayListenerFacts(statusByName, string(listener.Name), hostname, string(listener.Protocol), int32(listener.Port)))
	}
	return facts
}
