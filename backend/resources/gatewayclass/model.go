/*
 * backend/resources/gatewayclass/model.go
 *
 * GatewayClass resource model + facts + status presentation. Uses the exported
 * gateway-family helpers in resourcemodel (Gateway* link +
 * condition helpers); GatewayClass-specific fields live here.
 */

package gatewayclass

import (
	"github.com/luxury-yacht/app/backend/resourcemodel"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// BuildResourceModel builds the shared resource model for a GatewayClass. Facts
// are produced separately via BuildFacts (the model carries an empty facts union).
func BuildResourceModel(clusterID string, gatewayClass *gatewayv1.GatewayClass) resourcemodel.ResourceModel {
	status := buildStatusPresentation(gatewayClass)
	return resourcemodel.KubernetesResourceModel(clusterID, Identity, gatewayClass.ObjectMeta, status)
}

// BuildFacts projects a GatewayClass into its semantic facts.
func BuildFacts(clusterID string, gatewayClass *gatewayv1.GatewayClass) Facts {
	conditions := resourcemodel.GatewayConditionFacts(gatewayClass.Status.Conditions)
	facts := Facts{
		ControllerName: string(gatewayClass.Spec.ControllerName),
		Conditions:     conditions,
		Summary:        resourcemodel.GatewayConditionsSummary(conditions),
	}
	facts.Parameters = parameterLink(clusterID, gatewayClass.Spec.ParametersRef)
	return facts
}

func buildStatusPresentation(gatewayClass *gatewayv1.GatewayClass) resourcemodel.ResourceStatusPresentation {
	state := "0"
	label := "No conditions"
	if string(gatewayClass.Spec.ControllerName) != "" {
		label = string(gatewayClass.Spec.ControllerName)
	}
	return resourcemodel.GatewayStatusFromConditions(gatewayClass.ObjectMeta, state, label, resourcemodel.GatewayConditionFacts(gatewayClass.Status.Conditions))
}

func parameterLink(clusterID string, ref *gatewayv1.ParametersReference) *resourcemodel.ResourceLink {
	if ref == nil {
		return nil
	}
	namespace := ""
	if ref.Namespace != nil {
		namespace = string(*ref.Namespace)
	}
	link := resourcemodel.GatewayRefLink(clusterID, string(ref.Group), string(ref.Kind), namespace, string(ref.Name))
	return &link
}
