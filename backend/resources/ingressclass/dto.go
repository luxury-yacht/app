/*
 * backend/resources/ingressclass/dto.go
 *
 * IngressClass detail DTO (the frontend wire shape), co-located with its model
 * and detail builder.
 */

package ingressclass

type IngressClassDetails struct {
	Kind        string                  `json:"kind"`
	Name        string                  `json:"name"`
	Controller  string                  `json:"controller"`
	Age         string                  `json:"age"`
	IsDefault   bool                    `json:"isDefault"`
	Details     string                  `json:"details"`
	Parameters  *IngressClassParameters `json:"parameters,omitempty"`
	Labels      map[string]string       `json:"labels,omitempty"`
	Annotations map[string]string       `json:"annotations,omitempty"`
	Ingresses   []string                `json:"ingresses,omitempty"`
}

type IngressClassParameters struct {
	APIGroup  string `json:"apiGroup,omitempty"`
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace,omitempty"`
	Scope     string `json:"scope,omitempty"`
}
