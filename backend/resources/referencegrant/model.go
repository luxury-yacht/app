/*
 * backend/resources/referencegrant/model.go
 *
 * ReferenceGrant resource model + facts. Shared gateway/network helpers live in
 * resourcemodel; the from/to projection is ReferenceGrant-only.
 */

package referencegrant

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// BuildResourceModel builds the shared resource model for a ReferenceGrant.
func BuildResourceModel(clusterID string, grant *gatewayv1.ReferenceGrant) resourcemodel.ResourceModel {
	status := buildStatusPresentation(grant)
	return resourcemodel.KubernetesResourceModel(clusterID, Identity, grant.ObjectMeta, status, resourcemodel.ResourceFacts{})
}

// BuildFacts projects a ReferenceGrant into its semantic facts.
func BuildFacts(clusterID string, grant *gatewayv1.ReferenceGrant) Facts {
	facts := Facts{}
	for _, from := range grant.Spec.From {
		facts.From = append(facts.From, FromFacts{
			Group:     string(from.Group),
			Kind:      string(from.Kind),
			Namespace: string(from.Namespace),
		})
	}
	for _, to := range grant.Spec.To {
		facts.To = append(facts.To, resourcemodel.GatewayReferenceGrantToLink(clusterID, grant.Namespace, to))
	}
	return facts
}

func buildStatusPresentation(grant *gatewayv1.ReferenceGrant) resourcemodel.ResourceStatusPresentation {
	state := resourcemodel.GatewayCountState(len(grant.Spec.To))
	signals := []resourcemodel.ResourceStatusSignal{
		{Type: resourcemodel.StatusSignalResourceState, Name: "spec.from", Status: resourcemodel.GatewayCountState(len(grant.Spec.From))},
		{Type: resourcemodel.StatusSignalResourceState, Name: "spec.to", Status: state},
	}
	lifecycle := resourcemodel.ObjectLifecycle(grant.ObjectMeta)
	if status, ok := resourcemodel.DeletingObjectStatus(grant.ObjectMeta, state, signals, lifecycle); ok {
		return status
	}
	return resourcemodel.ObjectSourceStatus(fmt.Sprintf("%d from, %d to", len(grant.Spec.From), len(grant.Spec.To)), state, "", "", "ready", signals, lifecycle)
}
