/*
 * backend/resources/tlsroute/facts.go
 *
 * TLSRoute facts. The shared route base (RouteCommonFacts/RouteRuleFacts) stays
 * in resourcemodel; TLSRoute carries no fields beyond the common base.
 */

package tlsroute

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Facts is the semantic model for a TLSRoute.
type Facts struct {
	resourcemodel.RouteCommonFacts
}
