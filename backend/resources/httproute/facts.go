/*
 * backend/resources/httproute/facts.go
 *
 * HTTPRoute facts. The shared route base (RouteCommonFacts/RouteRuleFacts) stays
 * in resourcemodel; HTTPRoute carries no fields beyond the common base.
 */

package httproute

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Facts is the semantic model for an HTTPRoute.
type Facts struct {
	resourcemodel.RouteCommonFacts
}
