/*
 * backend/resources/grpcroute/facts.go
 *
 * GRPCRoute facts. The shared route base (RouteCommonFacts/RouteRuleFacts) stays
 * in resourcemodel; GRPCRoute carries no fields beyond the common base.
 */

package grpcroute

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Facts is the semantic model for a GRPCRoute.
type Facts struct {
	resourcemodel.RouteCommonFacts
}
