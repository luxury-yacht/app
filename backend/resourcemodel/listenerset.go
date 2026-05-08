package resourcemodel

import gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"

func BuildListenerSetResourceModel(clusterID string, listenerSet *gatewayv1.ListenerSet) ResourceModel {
	facts := BuildListenerSetFacts(clusterID, listenerSet)
	status := BuildListenerSetStatusPresentation(listenerSet, facts)
	return gatewayAPIResourceModel(clusterID, "ListenerSet", "listenersets", ResourceScopeNamespaced, listenerSet.ObjectMeta, status, ResourceFacts{ListenerSet: &facts})
}

func BuildListenerSetFacts(clusterID string, listenerSet *gatewayv1.ListenerSet) ListenerSetFacts {
	conditions := gatewayConditionFacts(listenerSet.Status.Conditions)
	return ListenerSetFacts{
		ParentRef:  gatewayParentGatewayRefLink(clusterID, listenerSet.Namespace, listenerSet.Spec.ParentRef),
		Listeners:  gatewayListenerFactsFromListenerSet(listenerSet.Spec.Listeners, listenerSet.Status.Listeners),
		Conditions: conditions,
		Summary:    gatewayConditionsSummary(conditions),
	}
}

func BuildListenerSetStatusPresentation(listenerSet *gatewayv1.ListenerSet, facts ListenerSetFacts) ResourceStatusPresentation {
	state := gatewayCountState(len(facts.Listeners))
	label := countLabel(len(facts.Listeners), "listener", "listeners")
	return gatewayStatusFromConditions(listenerSet.ObjectMeta, state, label, facts.Conditions)
}

func gatewayListenerFactsFromListenerSet(spec []gatewayv1.ListenerEntry, status []gatewayv1.ListenerEntryStatus) []GatewayListenerFacts {
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
