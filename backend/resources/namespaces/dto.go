/*
 * backend/resources/namespaces/dto.go
 *
 * Namespace detail DTO (the frontend wire shape), co-located with its model and
 * detail builder. Embeds the shared StatusProjection base (wails flattens it).
 */

package namespaces

import restypes "github.com/luxury-yacht/app/backend/resources/types"

// NamespaceDetails represents comprehensive namespace information.
type NamespaceDetails struct {
	Kind    string `json:"kind"`
	Name    string `json:"name"`
	Age     string `json:"age"`
	Details string `json:"details"`
	restypes.StatusProjection
	HasWorkloads     bool                 `json:"hasWorkloads"`
	WorkloadsUnknown bool                 `json:"workloadsUnknown,omitempty"`
	Labels           map[string]string    `json:"labels,omitempty"`
	Annotations      map[string]string    `json:"annotations,omitempty"`
	ResourceQuotas   []restypes.ObjectRef `json:"resourceQuotas,omitempty"`
	LimitRanges      []restypes.ObjectRef `json:"limitRanges,omitempty"`
}
