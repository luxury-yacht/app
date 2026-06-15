/*
 * backend/resources/ingress/dto.go
 *
 * Ingress detail DTOs (the frontend wire shape), co-located with its model and
 * detail builder.
 */

package ingress

type IngressDetails struct {
	Kind               string                 `json:"kind"`
	Name               string                 `json:"name"`
	Namespace          string                 `json:"namespace"`
	Age                string                 `json:"age"`
	Details            string                 `json:"details"`
	IngressClassName   *string                `json:"ingressClassName,omitempty"`
	Rules              []IngressRuleDetails   `json:"rules"`
	TLS                []IngressTLSDetails    `json:"tls,omitempty"`
	LoadBalancerStatus []string               `json:"loadBalancerStatus,omitempty"`
	DefaultBackend     *IngressBackendDetails `json:"defaultBackend,omitempty"`
	Labels             map[string]string      `json:"labels,omitempty"`
	Annotations        map[string]string      `json:"annotations,omitempty"`
}

type IngressRuleDetails struct {
	Host  string               `json:"host,omitempty"`
	Paths []IngressPathDetails `json:"paths"`
}

type IngressPathDetails struct {
	Path     string                `json:"path"`
	PathType string                `json:"pathType"`
	Backend  IngressBackendDetails `json:"backend"`
}

type IngressBackendDetails struct {
	ServiceName string `json:"serviceName,omitempty"`
	ServicePort string `json:"servicePort,omitempty"`
	Resource    string `json:"resource,omitempty"`
}

type IngressTLSDetails struct {
	Hosts      []string `json:"hosts"`
	SecretName string   `json:"secretName,omitempty"`
}
