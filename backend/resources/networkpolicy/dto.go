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
	Details      string              `json:"details"`
	PodSelector  LabelSelector       `json:"podSelector"`
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

// NetworkPolicyPeer omits an unset selector; an empty selector ({}) matches everything.
type NetworkPolicyPeer struct {
	PodSelector       *LabelSelector `json:"podSelector,omitempty"`
	NamespaceSelector *LabelSelector `json:"namespaceSelector,omitempty"`
	IPBlock           *IPBlock       `json:"ipBlock,omitempty"`
}

type LabelSelector struct {
	MatchLabels      map[string]string          `json:"matchLabels,omitempty"`
	MatchExpressions []LabelSelectorRequirement `json:"matchExpressions,omitempty"`
}

type LabelSelectorRequirement struct {
	Key      string   `json:"key"`
	Operator string   `json:"operator"`
	Values   []string `json:"values,omitempty"`
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
