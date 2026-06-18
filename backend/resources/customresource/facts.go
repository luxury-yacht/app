/*
 * backend/resources/customresource/facts.go
 *
 * Canonical CustomResource facts — the dynamic status extraction shared by the
 * streaming summary rows for any custom resource instance. CRD back-link and
 * Conditions reference shared resourcemodel primitives.
 */

package customresource

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Facts is the canonical CustomResource model facts (extracted from unstructured
// status of any custom resource instance).
type Facts struct {
	CRD                *resourcemodel.ResourceLink    `json:"crd,omitempty"`
	Phase              string                         `json:"phase,omitempty"`
	State              string                         `json:"state,omitempty"`
	Ready              *bool                          `json:"ready,omitempty"`
	ObservedGeneration *int64                         `json:"observedGeneration,omitempty"`
	Conditions         []resourcemodel.ConditionFacts `json:"conditions,omitempty"`
	RawStatus          map[string]any                 `json:"rawStatus,omitempty"`
}
