/*
 * backend/resources/limitrange/facts.go
 *
 * Canonical LimitRange facts. The quantity-map values reference the shared
 * resourcemodel.ResourceQuantityMapFacts primitive.
 */

package limitrange

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Facts is the canonical LimitRange model facts.
type Facts struct {
	Limits []LimitRangeItemFacts `json:"limits,omitempty"`
}

type LimitRangeItemFacts struct {
	Kind                 string                                 `json:"kind"`
	Max                  resourcemodel.ResourceQuantityMapFacts `json:"max,omitempty"`
	Min                  resourcemodel.ResourceQuantityMapFacts `json:"min,omitempty"`
	Default              resourcemodel.ResourceQuantityMapFacts `json:"default,omitempty"`
	DefaultRequest       resourcemodel.ResourceQuantityMapFacts `json:"defaultRequest,omitempty"`
	MaxLimitRequestRatio resourcemodel.ResourceQuantityMapFacts `json:"maxLimitRequestRatio,omitempty"`
}
