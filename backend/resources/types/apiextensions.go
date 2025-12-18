package types

import metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

// CustomResourceDefinitionDetails represents comprehensive CRD information.
type CustomResourceDefinitionDetails struct {
	Kind               string            `json:"kind"`
	Name               string            `json:"name"`
	Group              string            `json:"group"`
	Scope              string            `json:"scope"`
	Age                string            `json:"age"`
	Details            string            `json:"details"`
	Versions           []CRDVersion      `json:"versions"`
	Names              CRDNames          `json:"names"`
	ConversionStrategy string            `json:"conversionStrategy,omitempty"`
	Conditions         []CRDCondition    `json:"conditions,omitempty"`
	Labels             map[string]string `json:"labels,omitempty"`
	Annotations        map[string]string `json:"annotations,omitempty"`
}

// CRDVersion represents a version of a CRD.
type CRDVersion struct {
	Name       string                 `json:"name"`
	Served     bool                   `json:"served"`
	Storage    bool                   `json:"storage"`
	Deprecated bool                   `json:"deprecated,omitempty"`
	Schema     map[string]interface{} `json:"schema,omitempty"`
}

// CRDNames represents the names specification of a CRD.
type CRDNames struct {
	Plural     string   `json:"plural"`
	Singular   string   `json:"singular"`
	Kind       string   `json:"kind"`
	ListKind   string   `json:"listKind,omitempty"`
	ShortNames []string `json:"shortNames,omitempty"`
	Categories []string `json:"categories,omitempty"`
}

// CRDCondition represents a CRD status condition.
type CRDCondition struct {
	Kind               string      `json:"kind"`
	Status             string      `json:"status"`
	Reason             string      `json:"reason,omitempty"`
	Message            string      `json:"message,omitempty"`
	LastTransitionTime metav1.Time `json:"lastTransitionTime,omitempty"`
}
