/*
 * backend/resources/grpcroute/details.go
 *
 * GRPCRoute detail service. The CRD-discovery + fetch seam stays in
 * resources/gatewayapi; GRPCRoute returns the shared types.RouteDetails DTO.
 */

package grpcroute

import (
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/gatewayapi"
	"github.com/luxury-yacht/app/backend/resources/types"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// Service retrieves GRPCRoute details.
type Service struct {
	deps common.Dependencies
}

// NewService builds a GRPCRoute detail service.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// GRPCRoute returns the detail payload for a single GRPCRoute.
func (s *Service) GRPCRoute(namespace, name string) (*types.RouteDetails, error) {
	return gatewayapi.GetResource(s.deps, "GRPCRoute", "grpc route",
		func() (*gatewayv1.GRPCRoute, error) {
			return s.deps.GatewayClient.GatewayV1().GRPCRoutes(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
		}, s.buildDetails)
}

func (s *Service) buildDetails(item *gatewayv1.GRPCRoute) *types.RouteDetails {
	facts := BuildFacts(s.deps.ClusterID, item).RouteCommonFacts
	detail := types.RouteDetailsFromFacts("GRPCRoute", item.ObjectMeta, facts)
	detail.Details = types.RouteDetailsText(len(facts.Rules), len(detail.ParentRefs), len(detail.BackendRefs))
	return detail
}
