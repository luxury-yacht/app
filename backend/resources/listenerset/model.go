/*
 * backend/resources/listenerset/model.go
 *
 * ListenerSet resource model + facts. Shared gateway helpers live in resourcemodel;
 * the per-listener extraction from the typed ListenerSet object is ListenerSet-only.
 */

package listenerset

import (
	"github.com/luxury-yacht/app/backend/resourcemodel"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// BuildResourceModel builds the shared resource model for a ListenerSet.
func BuildResourceModel(clusterID string, listenerSet *gatewayv1.ListenerSet) resourcemodel.ResourceModel {
	facts := BuildFacts(clusterID, listenerSet)
	status := buildStatusPresentation(listenerSet, facts)
	return resourcemodel.GatewayAPIResourceModel(clusterID, "ListenerSet", "listenersets", resourcemodel.ResourceScopeNamespaced, listenerSet.ObjectMeta, status, resourcemodel.ResourceFacts{})
}

// BuildFacts projects a ListenerSet into its semantic facts.
func BuildFacts(clusterID string, listenerSet *gatewayv1.ListenerSet) Facts {
	conditions := resourcemodel.GatewayConditionFacts(listenerSet.Status.Conditions)
	return Facts{
		ParentRef:  resourcemodel.GatewayParentGatewayRefLink(clusterID, listenerSet.Namespace, listenerSet.Spec.ParentRef),
		Listeners:  listenerFacts(listenerSet.Spec.Listeners, listenerSet.Status.Listeners),
		Conditions: conditions,
		Summary:    resourcemodel.GatewayConditionsSummary(conditions),
	}
}

func buildStatusPresentation(listenerSet *gatewayv1.ListenerSet, facts Facts) resourcemodel.ResourceStatusPresentation {
	state := resourcemodel.GatewayCountState(len(facts.Listeners))
	label := resourcemodel.CountLabel(len(facts.Listeners), "listener", "listeners")
	return resourcemodel.GatewayStatusFromConditions(listenerSet.ObjectMeta, state, label, facts.Conditions)
}

func listenerFacts(spec []gatewayv1.ListenerEntry, status []gatewayv1.ListenerEntryStatus) []resourcemodel.GatewayListenerFacts {
	statusByName := map[string]resourcemodel.GatewayListenerStatusFacts{}
	for _, listenerStatus := range status {
		statusByName[string(listenerStatus.Name)] = resourcemodel.GatewayListenerStatusFacts{
			AttachedRoutes: int32(listenerStatus.AttachedRoutes),
			Conditions:     listenerStatus.Conditions,
		}
	}
	facts := make([]resourcemodel.GatewayListenerFacts, 0, len(spec))
	for _, listener := range spec {
		hostname := ""
		if listener.Hostname != nil {
			hostname = string(*listener.Hostname)
		}
		facts = append(facts, resourcemodel.BuildGatewayListenerFacts(statusByName, string(listener.Name), hostname, string(listener.Protocol), int32(listener.Port)))
	}
	return facts
}
