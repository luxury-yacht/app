/*
 * backend/resources/resourcequota/facts.go
 *
 * Canonical ResourceQuota facts. ResourceQuantityMapFacts (the quantity-map
 * primitive) stays shared in resourcemodel; the scope sub-types are RQ-only.
 */

package resourcequota

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Facts is the canonical ResourceQuota model facts.
type Facts struct {
	Hard           resourcemodel.ResourceQuantityMapFacts `json:"hard,omitempty"`
	Used           resourcemodel.ResourceQuantityMapFacts `json:"used,omitempty"`
	UsedPercentage map[string]int                         `json:"usedPercentage,omitempty"`
	Scopes         []string                               `json:"scopes,omitempty"`
	ScopeSelector  *ScopeSelectorFacts                    `json:"scopeSelector,omitempty"`
}

type ScopeSelectorFacts struct {
	MatchExpressions []ScopeSelectorRequirementFacts `json:"matchExpressions,omitempty"`
}

type ScopeSelectorRequirementFacts struct {
	ScopeName string   `json:"scopeName"`
	Operator  string   `json:"operator"`
	Values    []string `json:"values,omitempty"`
}
