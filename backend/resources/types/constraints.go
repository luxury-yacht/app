/*
 * backend/resources/types/constraints.go
 *
 * Type definitions for Constraints resources.
 * - Shared data structures for API responses.
 */

package types

// LimitRangeDetails represents comprehensive limit range information.
type LimitRangeDetails struct {
	Kind        string            `json:"kind"`
	Name        string            `json:"name"`
	Namespace   string            `json:"namespace"`
	Age         string            `json:"age"`
	Details     string            `json:"details"`
	Limits      []LimitRangeItem  `json:"limits"`
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
}

// LimitRangeItem describes a single limit range entry.
type LimitRangeItem struct {
	Kind                 string            `json:"kind"`
	Max                  map[string]string `json:"max,omitempty"`
	Min                  map[string]string `json:"min,omitempty"`
	Default              map[string]string `json:"default,omitempty"`
	DefaultRequest       map[string]string `json:"defaultRequest,omitempty"`
	MaxLimitRequestRatio map[string]string `json:"maxLimitRequestRatio,omitempty"`
}

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
