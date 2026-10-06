/*
 * backend/resources/networkpolicy/facts.go
 *
 * Canonical NetworkPolicy facts — the single typed extraction of a NetworkPolicy's
 * intrinsic fields, with its kind-specific rule/peer/port/IP-block sub-types.
 */

package networkpolicy

// Facts is the canonical NetworkPolicy model facts.
type Facts struct {
	PodSelector  LabelSelectorFacts `json:"podSelector"`
	PolicyTypes  []string           `json:"policyTypes,omitempty"`
	IngressRules []RuleFacts        `json:"ingressRules,omitempty"`
	EgressRules  []RuleFacts        `json:"egressRules,omitempty"`
}

type RuleFacts struct {
	Peers []PeerFacts `json:"peers,omitempty"`
	Ports []PortFacts `json:"ports,omitempty"`
}

// PeerFacts keeps selector presence: nil means the selector was not set, while an empty
// selector matches everything (a nil NamespaceSelector scopes the peer to the policy namespace).
type PeerFacts struct {
	PodSelector       *LabelSelectorFacts `json:"podSelector,omitempty"`
	NamespaceSelector *LabelSelectorFacts `json:"namespaceSelector,omitempty"`
	IPBlock           *IPBlockFacts       `json:"ipBlock,omitempty"`
}

// LabelSelectorFacts is a pod or namespace label selector.
type LabelSelectorFacts struct {
	MatchLabels      map[string]string               `json:"matchLabels,omitempty"`
	MatchExpressions []LabelSelectorRequirementFacts `json:"matchExpressions,omitempty"`
}

// LabelSelectorRequirementFacts is a single selector requirement.
type LabelSelectorRequirementFacts struct {
	Key      string   `json:"key"`
	Operator string   `json:"operator"`
	Values   []string `json:"values,omitempty"`
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
