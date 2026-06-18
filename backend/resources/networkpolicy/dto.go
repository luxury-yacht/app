/*
 * backend/resources/networkpolicy/dto.go
 *
 * NetworkPolicy detail DTO (the frontend wire shape) + its kind-specific
 * sub-types, co-located with the model and detail builder.
 */

package networkpolicy

type NetworkPolicyDetails struct {
	Kind         string              `json:"kind"`
	Name         string              `json:"name"`
	Namespace    string              `json:"namespace"`
	Age          string              `json:"age"`
	Details      string              `json:"details"`
	PodSelector  map[string]string   `json:"podSelector"`
	PolicyTypes  []string            `json:"policyTypes"`
	IngressRules []NetworkPolicyRule `json:"ingressRules,omitempty"`
	EgressRules  []NetworkPolicyRule `json:"egressRules,omitempty"`
	Labels       map[string]string   `json:"labels,omitempty"`
	Annotations  map[string]string   `json:"annotations,omitempty"`
}

type NetworkPolicyRule struct {
	From  []NetworkPolicyPeer `json:"from,omitempty"`
	To    []NetworkPolicyPeer `json:"to,omitempty"`
	Ports []NetworkPolicyPort `json:"ports,omitempty"`
}

type NetworkPolicyPeer struct {
	PodSelector       map[string]string `json:"podSelector,omitempty"`
	NamespaceSelector map[string]string `json:"namespaceSelector,omitempty"`
	IPBlock           *IPBlock          `json:"ipBlock,omitempty"`
}

type IPBlock struct {
	CIDR   string   `json:"cidr"`
	Except []string `json:"except,omitempty"`
}

type NetworkPolicyPort struct {
	Protocol string  `json:"protocol,omitempty"`
	Port     *string `json:"port,omitempty"`
	EndPort  *int32  `json:"endPort,omitempty"`
}
