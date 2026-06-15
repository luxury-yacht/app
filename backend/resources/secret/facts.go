/*
 * backend/resources/secret/facts.go
 *
 * Canonical Secret facts — the single typed extraction of a Secret's intrinsic
 * fields. UsedBy reverse-links reference resourcemodel.ResourceLink.
 */

package secret

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Facts is the canonical Secret model facts.
type Facts struct {
	Type          string                       `json:"type,omitempty"`
	DataKeys      []string                     `json:"dataKeys,omitempty"`
	DataCount     int                          `json:"dataCount"`
	DataSizeBytes int64                        `json:"dataSizeBytes"`
	Immutable     *bool                        `json:"immutable,omitempty"`
	UsedBy        []resourcemodel.ResourceLink `json:"usedBy,omitempty"`
}
