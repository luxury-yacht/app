/*
 * backend/resources/httproute/details.go
 *
 * HTTPRoute detail service. The CRD-discovery + fetch seam stays in
 * resources/gatewayapi; HTTPRoute returns the shared types.RouteDetails DTO.
 */

package httproute

import (
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/gatewayapi"
	"github.com/luxury-yacht/app/backend/resources/types"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// Service retrieves HTTPRoute details.
type Service struct {
	deps common.Dependencies
}

// NewService builds an HTTPRoute detail service.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// HTTPRoute returns the detail payload for a single HTTPRoute.
func (s *Service) HTTPRoute(namespace, name string) (*types.RouteDetails, error) {
	return gatewayapi.GetResource(s.deps, "HTTPRoute", "http route",
		func() (*gatewayv1.HTTPRoute, error) {
			return s.deps.GatewayClient.GatewayV1().HTTPRoutes(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
		}, s.buildDetails)
}

// HTTPRoutes lists HTTPRoute detail payloads.
func (s *Service) HTTPRoutes(namespace string) ([]*types.RouteDetails, error) {
	return gatewayapi.ListResources(s.deps, "HTTPRoute", "http routes",
		func() ([]gatewayv1.HTTPRoute, error) {
			list, err := s.deps.GatewayClient.GatewayV1().HTTPRoutes(namespace).List(s.deps.Context, metav1.ListOptions{})
			if err != nil {
				return nil, err
			}
			return list.Items, nil
		}, s.buildDetails)
}

func (s *Service) buildDetails(item *gatewayv1.HTTPRoute) *types.RouteDetails {
	facts := BuildFacts(s.deps.ClusterID, item).RouteCommonFacts
	detail := types.RouteDetailsFromFacts("HTTPRoute", item.ObjectMeta, facts)
	detail.Details = types.RouteDetailsText(len(facts.Rules), len(detail.ParentRefs), len(detail.BackendRefs))
	return detail
}
