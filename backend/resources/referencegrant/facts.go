/*
 * backend/resources/referencegrant/facts.go
 *
 * ReferenceGrant facts. FromFacts is ReferenceGrant-only; the To links reuse the
 * shared resourcemodel.ResourceLink.
 */

package referencegrant

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Facts is the semantic model for a ReferenceGrant.
type Facts struct {
	From []FromFacts                  `json:"from,omitempty"`
	To   []resourcemodel.ResourceLink `json:"to,omitempty"`
}

// FromFacts is one entry in a ReferenceGrant's spec.from list.
type FromFacts struct {
	Group     string `json:"group,omitempty"`
	Kind      string `json:"kind,omitempty"`
	Namespace string `json:"namespace,omitempty"`
}
