/*
 * backend/resources/networkpolicy/facts.go
 *
 * Canonical NetworkPolicy facts — the single typed extraction of a NetworkPolicy's
 * intrinsic fields, with its kind-specific rule/peer/port/IP-block sub-types.
 */

package networkpolicy

// Facts is the canonical NetworkPolicy model facts.
type Facts struct {
	PodSelector  map[string]string `json:"podSelector,omitempty"`
	PolicyTypes  []string          `json:"policyTypes,omitempty"`
	IngressRules []RuleFacts       `json:"ingressRules,omitempty"`
	EgressRules  []RuleFacts       `json:"egressRules,omitempty"`
}

type RuleFacts struct {
	Peers []PeerFacts `json:"peers,omitempty"`
	Ports []PortFacts `json:"ports,omitempty"`
}

type PeerFacts struct {
	PodSelector       map[string]string `json:"podSelector,omitempty"`
	NamespaceSelector map[string]string `json:"namespaceSelector,omitempty"`
	IPBlock           *IPBlockFacts     `json:"ipBlock,omitempty"`
}

type PortFacts struct {
	Protocol string `json:"protocol,omitempty"`
	Port     string `json:"port,omitempty"`
	EndPort  *int32 `json:"endPort,omitempty"`
}

type IPBlockFacts struct {
	CIDR   string   `json:"cidr,omitempty"`
	Except []string `json:"except,omitempty"`
}
