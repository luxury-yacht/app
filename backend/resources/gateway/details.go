/*
 * backend/resources/gateway/details.go
 *
 * Gateway detail service. The CRD-discovery + fetch seam stays in resources/gatewayapi.
 */

package gateway

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/gatewayapi"
	"github.com/luxury-yacht/app/backend/resources/types"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// Service retrieves Gateway details.
type Service struct {
	deps common.Dependencies
}

// NewService builds a Gateway detail service.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// Gateway returns the detail payload for a single Gateway.
func (s *Service) Gateway(namespace, name string) (*GatewayDetails, error) {
	return gatewayapi.GetResource(s.deps, "Gateway", "gateway",
		func() (*gatewayv1.Gateway, error) {
			return s.deps.GatewayClient.GatewayV1().Gateways(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
		}, s.buildDetails)
}

// Gateways lists Gateway detail payloads.
func (s *Service) Gateways(namespace string) ([]*GatewayDetails, error) {
	return gatewayapi.ListResources(s.deps, "Gateway", "gateways",
		func() ([]gatewayv1.Gateway, error) {
			list, err := s.deps.GatewayClient.GatewayV1().Gateways(namespace).List(s.deps.Context, metav1.ListOptions{})
			if err != nil {
				return nil, err
			}
			return list.Items, nil
		}, s.buildDetails)
}

func (s *Service) buildDetails(item *gatewayv1.Gateway) *GatewayDetails {
	facts := BuildFacts(s.deps.ClusterID, item)
	detail := &GatewayDetails{
		Kind:            "Gateway",
		Name:            item.Name,
		Namespace:       item.Namespace,
		Age:             common.FormatAge(item.CreationTimestamp.Time),
		GatewayClassRef: types.ObjectRefFromResourceLink(facts.Class),
		Addresses:       append([]string(nil), facts.Addresses...),
		Listeners:       types.GatewayListenerDetailsFromFacts(facts.Listeners),
		Conditions:      types.ConditionStatesFromFacts(facts.Conditions),
		Summary:         types.ConditionsSummaryFromFacts(facts.Summary),
		Labels:          item.Labels,
		Annotations:     item.Annotations,
	}
	detail.Details = fmt.Sprintf("%d listener(s)", len(facts.Listeners))
	if len(detail.Addresses) > 0 {
		detail.Details = fmt.Sprintf("%s, %s", detail.Details, detail.Addresses[0])
	}
	return detail
}
