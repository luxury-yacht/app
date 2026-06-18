/*
 * backend/resources/limitrange/dto.go
 *
 * LimitRange detail DTO (the frontend wire shape) + its item sub-type.
 */

package limitrange

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
