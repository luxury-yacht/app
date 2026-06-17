/*
 * backend/resources/helm/dto.go
 *
 * HelmRelease detail DTOs (the frontend wire shape), co-located with its model and
 * detail builder. HelmReleaseDetails + HelmRevision embed the shared StatusProjection.
 */

package helm

import restypes "github.com/luxury-yacht/app/backend/resources/types"

// HelmReleaseDetails represents detailed information about a Helm release.
type HelmReleaseDetails struct {
	Kind      string `json:"kind"`
	TypeAlias string `json:"typeAlias"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Age       string `json:"age"`

	Chart      string `json:"chart"`
	Version    string `json:"version"`
	AppVersion string `json:"appVersion"`

	restypes.StatusProjection
	Revision int    `json:"revision"`
	Updated  string `json:"updated"`

	Description string                 `json:"description,omitempty"`
	Notes       string                 `json:"notes,omitempty"`
	Values      map[string]interface{} `json:"values,omitempty"`

	History []HelmRevision `json:"history,omitempty"`

	Resources []HelmResource `json:"resources,omitempty"`

	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
}

// HelmRevision is a single release history entry.
type HelmRevision struct {
	Revision int    `json:"revision"`
	Updated  string `json:"updated"`
	restypes.StatusProjection
	Chart       string `json:"chart"`
	AppVersion  string `json:"appVersion,omitempty"`
	Description string `json:"description,omitempty"`
}

// HelmResource is a Kubernetes resource managed by the release manifest.
type HelmResource struct {
	Kind       string `json:"kind"`
	APIVersion string `json:"apiVersion,omitempty"`
	Name       string `json:"name"`
	Namespace  string `json:"namespace"`
	Scope      string `json:"scope,omitempty"`
}
