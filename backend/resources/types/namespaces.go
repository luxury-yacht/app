package types

// NamespaceDetails represents comprehensive namespace information.
type NamespaceDetails struct {
	Kind             string            `json:"kind"`
	Name             string            `json:"name"`
	Age              string            `json:"age"`
	Details          string            `json:"details"`
	Status           string            `json:"status"`
	HasWorkloads     bool              `json:"hasWorkloads"`
	WorkloadsUnknown bool              `json:"workloadsUnknown,omitempty"`
	Labels           map[string]string `json:"labels,omitempty"`
	Annotations      map[string]string `json:"annotations,omitempty"`
	ResourceQuotas   []string          `json:"resourceQuotas,omitempty"`
	LimitRanges      []string          `json:"limitRanges,omitempty"`
}
