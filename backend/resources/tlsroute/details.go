/*
 * backend/resources/tlsroute/details.go
 *
 * TLSRoute detail service. The CRD-discovery + fetch seam stays in
 * resources/gatewayapi; TLSRoute returns the shared types.RouteDetails DTO.
 */

package tlsroute

import (
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/gatewayapi"
	"github.com/luxury-yacht/app/backend/resources/types"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// Service retrieves TLSRoute details.
type Service struct {
	deps common.Dependencies
}

// NewService builds a TLSRoute detail service.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// TLSRoute returns the detail payload for a single TLSRoute.
func (s *Service) TLSRoute(namespace, name string) (*types.RouteDetails, error) {
	return gatewayapi.GetResource(s.deps, "TLSRoute", "tls route",
		func() (*gatewayv1.TLSRoute, error) {
			return s.deps.GatewayClient.GatewayV1().TLSRoutes(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
		}, s.buildDetails)
}

// TLSRoutes lists TLSRoute detail payloads.
func (s *Service) TLSRoutes(namespace string) ([]*types.RouteDetails, error) {
	return gatewayapi.ListResources(s.deps, "TLSRoute", "tls routes",
		func() ([]gatewayv1.TLSRoute, error) {
			list, err := s.deps.GatewayClient.GatewayV1().TLSRoutes(namespace).List(s.deps.Context, metav1.ListOptions{})
			if err != nil {
				return nil, err
			}
			return list.Items, nil
		}, s.buildDetails)
}

func (s *Service) buildDetails(item *gatewayv1.TLSRoute) *types.RouteDetails {
	facts := BuildFacts(s.deps.ClusterID, item).RouteCommonFacts
	detail := types.RouteDetailsFromFacts("TLSRoute", item.ObjectMeta, facts)
	detail.Details = types.RouteDetailsText(len(facts.Rules), len(detail.ParentRefs), len(detail.BackendRefs))
	return detail
}
