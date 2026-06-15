/*
 * backend/resources/ingress/facts.go
 *
 * Canonical Ingress facts — the single typed extraction of an Ingress's
 * intrinsic fields. Sub-types reference the shared resourcemodel.ResourceLink.
 */

package ingress

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Facts is the canonical Ingress model facts.
type Facts struct {
	ClassName      string                       `json:"className,omitempty"`
	Class          *resourcemodel.ResourceLink  `json:"class,omitempty"`
	Hosts          []string                     `json:"hosts,omitempty"`
	Addresses      []string                     `json:"addresses,omitempty"`
	TLS            []TLSFacts                    `json:"tls,omitempty"`
	Rules          []RuleFacts                  `json:"rules,omitempty"`
	DefaultBackend *BackendFacts                `json:"defaultBackend,omitempty"`
	BackendRefs    []resourcemodel.ResourceLink `json:"backendRefs,omitempty"`
}

// TLSFacts describes a single Ingress TLS block.
type TLSFacts struct {
	Hosts     []string                    `json:"hosts,omitempty"`
	SecretRef *resourcemodel.ResourceLink `json:"secretRef,omitempty"`
}

// RuleFacts describes a single Ingress host rule.
type RuleFacts struct {
	Host  string      `json:"host,omitempty"`
	Paths []PathFacts `json:"paths,omitempty"`
}

// PathFacts describes a single HTTP path within an Ingress rule.
type PathFacts struct {
	Path     string      `json:"path,omitempty"`
	PathType string      `json:"pathType,omitempty"`
	Backend  BackendFacts `json:"backend"`
}

// BackendFacts describes the backend for an Ingress path or default backend.
type BackendFacts struct {
	ServiceName string                      `json:"serviceName,omitempty"`
	ServicePort string                      `json:"servicePort,omitempty"`
	Service     *resourcemodel.ResourceLink `json:"service,omitempty"`
	Resource    string                      `json:"resource,omitempty"`
}
