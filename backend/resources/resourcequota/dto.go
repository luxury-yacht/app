/*
 * backend/resources/resourcequota/dto.go
 *
 * ResourceQuota detail DTO (the frontend wire shape) + its scope sub-types.
 */

package resourcequota

// ResourceQuotaDetails captures usage and limits for a namespace quota.
type ResourceQuotaDetails struct {
	Kind           string            `json:"kind"`
	Name           string            `json:"name"`
	Namespace      string            `json:"namespace"`
	Age            string            `json:"age"`
	Details        string            `json:"details"`
	Hard           map[string]string `json:"hard"`
	Used           map[string]string `json:"used"`
	Scopes         []string          `json:"scopes,omitempty"`
	ScopeSelector  *ScopeSelector    `json:"scopeSelector,omitempty"`
	UsedPercentage map[string]int    `json:"usedPercentage,omitempty"`
	Labels         map[string]string `json:"labels,omitempty"`
	Annotations    map[string]string `json:"annotations,omitempty"`
}

// ScopeSelector refines the resources controlled by a quota.
type ScopeSelector struct {
	MatchExpressions []ScopeSelectorRequirement `json:"matchExpressions,omitempty"`
}

// ScopeSelectorRequirement mirrors corev1.ScopedResourceSelectorRequirement for transport.
type ScopeSelectorRequirement struct {
	ScopeName string   `json:"scopeName"`
	Operator  string   `json:"operator"`
	Values    []string `json:"values,omitempty"`
}
