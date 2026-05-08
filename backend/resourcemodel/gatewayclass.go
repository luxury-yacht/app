package resourcemodel

import gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"

func BuildGatewayClassResourceModel(clusterID string, gatewayClass *gatewayv1.GatewayClass) ResourceModel {
	facts := BuildGatewayClassFacts(clusterID, gatewayClass)
	status := BuildGatewayClassStatusPresentation(gatewayClass, facts)
	return gatewayAPIResourceModel(clusterID, "GatewayClass", "gatewayclasses", ResourceScopeCluster, gatewayClass.ObjectMeta, status, ResourceFacts{GatewayClass: &facts})
}

func BuildGatewayClassFacts(clusterID string, gatewayClass *gatewayv1.GatewayClass) GatewayClassFacts {
	conditions := gatewayConditionFacts(gatewayClass.Status.Conditions)
	facts := GatewayClassFacts{
		ControllerName: string(gatewayClass.Spec.ControllerName),
		Conditions:     conditions,
		Summary:        gatewayConditionsSummary(conditions),
	}
	if gatewayClass.Spec.ParametersRef != nil {
		ref := gatewayClass.Spec.ParametersRef
		namespace := ""
		if ref.Namespace != nil {
			namespace = string(*ref.Namespace)
		}
		link := gatewayRefLink(clusterID, string(ref.Group), string(ref.Kind), namespace, string(ref.Name))
		facts.Parameters = &link
	}
	return facts
}

func BuildGatewayClassStatusPresentation(gatewayClass *gatewayv1.GatewayClass, facts GatewayClassFacts) ResourceStatusPresentation {
	state := "0"
	label := "No conditions"
	if facts.ControllerName != "" {
		label = facts.ControllerName
	}
	return gatewayStatusFromConditions(gatewayClass.ObjectMeta, state, label, facts.Conditions)
}
