/*
 * backend/resources/service/facts.go
 *
 * Canonical Service facts — the single typed extraction of a Service's intrinsic
 * fields (type, IPs, ports, selector, endpoints aggregated from EndpointSlices).
 */

package service

// Facts is the canonical Service model facts.
type Facts struct {
	Type                   string            `json:"type,omitempty"`
	ClusterIP              string            `json:"clusterIP,omitempty"`
	ClusterIPs             []string          `json:"clusterIPs,omitempty"`
	ExternalIPs            []string          `json:"externalIPs,omitempty"`
	LoadBalancerAddresses  []string          `json:"loadBalancerAddresses,omitempty"`
	ExternalName           string            `json:"externalName,omitempty"`
	Ports                  []PortFacts       `json:"ports,omitempty"`
	SessionAffinity        string            `json:"sessionAffinity,omitempty"`
	SessionAffinityTimeout int32             `json:"sessionAffinityTimeout,omitempty"`
	Selector               map[string]string `json:"selector,omitempty"`
	Endpoints              []string          `json:"endpoints,omitempty"`
	ReadyEndpointCount     int               `json:"readyEndpointCount"`
	NotReadyEndpointCount  int               `json:"notReadyEndpointCount"`
	TotalEndpointCount     int               `json:"totalEndpointCount"`
}

// PortFacts describes a single Service port.
type PortFacts struct {
	Name       string `json:"name,omitempty"`
	Protocol   string `json:"protocol,omitempty"`
	Port       int32  `json:"port"`
	TargetPort string `json:"targetPort,omitempty"`
	NodePort   int32  `json:"nodePort,omitempty"`
}
