/*
 * backend/resources/configmap/facts.go
 *
 * Canonical ConfigMap facts — the single typed extraction of a ConfigMap's
 * intrinsic fields. UsedBy reverse-links reference resourcemodel.ResourceLink.
 */

package configmap

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Facts is the canonical ConfigMap model facts.
type Facts struct {
	DataKeys       []string                     `json:"dataKeys,omitempty"`
	BinaryDataKeys []string                     `json:"binaryDataKeys,omitempty"`
	DataCount      int                          `json:"dataCount"`
	DataSizeBytes  int64                        `json:"dataSizeBytes"`
	UsedBy         []resourcemodel.ResourceLink `json:"usedBy,omitempty"`
}
