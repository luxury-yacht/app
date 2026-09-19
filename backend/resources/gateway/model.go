/*
 * backend/resources/gateway/model.go
 *
 * Gateway resource model + facts. Shared gateway helpers (model constructor,
 * condition/link helpers, listener-fact assembly) live in resourcemodel; the
 * per-listener extraction from the typed Gateway object is Gateway-only.
 */

package gateway

import (
	"github.com/luxury-yacht/app/backend/resourcemodel"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// BuildResourceModel builds the shared resource model for a Gateway.
func BuildResourceModel(clusterID string, gateway *gatewayv1.Gateway) resourcemodel.ResourceModel {
	status := buildStatusPresentation(gateway)
	return resourcemodel.KubernetesResourceModel(clusterID, Identity, gateway.ObjectMeta, status)
}

// BuildFacts projects a Gateway into its semantic facts.
func BuildFacts(clusterID string, gateway *gatewayv1.Gateway) Facts {
	conditions := resourcemodel.GatewayConditionFacts(gateway.Status.Conditions)
	class := resourcemodel.GatewayClassLink(clusterID, gateway.Spec.GatewayClassName)
	return Facts{
		Class:      &class,
		Addresses:  resourcemodel.GatewayAddressValues(gateway.Status.Addresses),
		Listeners:  listenerFacts(gateway.Spec.Listeners, gateway.Status.Listeners),
		Conditions: conditions,
		Summary:    resourcemodel.GatewayConditionsSummary(conditions),
	}
}

func buildStatusPresentation(gateway *gatewayv1.Gateway) resourcemodel.ResourceStatusPresentation {
	state := resourcemodel.GatewayCountState(len(gateway.Status.Addresses))
	label := resourcemodel.CountLabel(len(gateway.Spec.Listeners), "listener", "listeners")
	return resourcemodel.GatewayStatusFromConditions(gateway.ObjectMeta, state, label, resourcemodel.GatewayConditionFacts(gateway.Status.Conditions))
}

func listenerFacts(spec []gatewayv1.Listener, status []gatewayv1.ListenerStatus) []resourcemodel.GatewayListenerFacts {
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
