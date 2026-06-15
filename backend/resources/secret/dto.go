/*
 * backend/resources/secret/dto.go
 *
 * Secret detail DTO (the frontend wire shape), co-located with its model and
 * detail builder. UsedBy uses the shared restypes.ObjectRef.
 */

package secret

import restypes "github.com/luxury-yacht/app/backend/resources/types"

type SecretDetails struct {
	Kind        string               `json:"kind"`
	Name        string               `json:"name"`
	Namespace   string               `json:"namespace"`
	Age         string               `json:"age"`
	Details     string               `json:"details"`
	SecretType  string               `json:"secretType"`
	Data        map[string]string    `json:"data,omitempty"`
	DataKeys    []string             `json:"dataKeys"`
	DataCount   int                  `json:"dataCount"`
	Labels      map[string]string    `json:"labels,omitempty"`
	Annotations map[string]string    `json:"annotations,omitempty"`
	UsedBy      []restypes.ObjectRef `json:"usedBy,omitempty"`
}
