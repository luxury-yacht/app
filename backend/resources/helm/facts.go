/*
 * backend/resources/helm/facts.go
 *
 * Canonical HelmRelease facts and revision history.
 */

package helm

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Facts is the canonical HelmRelease model facts.
type Facts struct {
	Chart       string              `json:"chart,omitempty"`
	Version     string              `json:"version,omitempty"`
	AppVersion  string              `json:"appVersion,omitempty"`
	Revision    int                 `json:"revision"`
	RawStatus   string              `json:"rawStatus,omitempty"`
	Updated     *metav1.Time        `json:"updated,omitempty"`
	Description string              `json:"description,omitempty"`
	Notes       string              `json:"notes,omitempty"`
	History     []HelmRevisionFacts `json:"history,omitempty"`
}

// HelmRevisionFacts describes a single HelmRelease history revision.
type HelmRevisionFacts struct {
	Revision    int          `json:"revision"`
	Updated     *metav1.Time `json:"updated,omitempty"`
	Status      string       `json:"status,omitempty"`
	Chart       string       `json:"chart,omitempty"`
	AppVersion  string       `json:"appVersion,omitempty"`
	Description string       `json:"description,omitempty"`
}
