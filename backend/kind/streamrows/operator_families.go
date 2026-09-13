package streamrows

import "github.com/luxury-yacht/app/backend/resourcemodel"

type CertManagerSummary struct {
	IssuerType string                      `json:"issuerType,omitempty"`
	Server     string                      `json:"server,omitempty"`
	Issuer     *resourcemodel.ResourceLink `json:"issuer,omitempty"`
	Secret     *resourcemodel.ResourceLink `json:"secret,omitempty"`
	NotAfter   string                      `json:"notAfter,omitempty"`
}

type ExternalSecretsSummary struct {
	Provider        string                      `json:"provider,omitempty"`
	StoreName       string                      `json:"storeName,omitempty"`
	Store           *resourcemodel.ResourceLink `json:"store,omitempty"`
	Target          *resourcemodel.ResourceLink `json:"target,omitempty"`
	TargetName      string                      `json:"targetName,omitempty"`
	RefreshInterval string                      `json:"refreshInterval,omitempty"`
}

type PrometheusSummary struct {
	Endpoints         *int   `json:"endpoints,omitempty"`
	Rules             *int   `json:"rules,omitempty"`
	Version           string `json:"version,omitempty"`
	Replicas          *int64 `json:"replicas,omitempty"`
	AvailableReplicas *int64 `json:"availableReplicas,omitempty"`
}
