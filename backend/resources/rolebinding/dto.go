/*
 * backend/resources/rolebinding/dto.go
 *
 * RoleBinding detail DTO (the frontend wire shape). RoleRef/Subject sub-types are
 * shared rbac primitives that stay in resources/types.
 */

package rolebinding

import restypes "github.com/luxury-yacht/app/backend/resources/types"

type RoleBindingDetails struct {
	Kind        string             `json:"kind"`
	Name        string             `json:"name"`
	Namespace   string             `json:"namespace"`
	Age         string             `json:"age"`
	Details     string             `json:"details"`
	RoleRef     restypes.RoleRef   `json:"roleRef"`
	Subjects    []restypes.Subject `json:"subjects"`
	Labels      map[string]string  `json:"labels,omitempty"`
	Annotations map[string]string  `json:"annotations,omitempty"`
}
