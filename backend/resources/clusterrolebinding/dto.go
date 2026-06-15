/*
 * backend/resources/clusterrolebinding/dto.go
 *
 * ClusterRoleBinding detail DTO (the frontend wire shape). RoleRef/Subject
 * sub-types are shared rbac primitives that stay in resources/types.
 */

package clusterrolebinding

import restypes "github.com/luxury-yacht/app/backend/resources/types"

type ClusterRoleBindingDetails struct {
	Kind        string             `json:"kind"`
	Name        string             `json:"name"`
	Age         string             `json:"age"`
	Details     string             `json:"details"`
	RoleRef     restypes.RoleRef   `json:"roleRef"`
	Subjects    []restypes.Subject `json:"subjects"`
	Labels      map[string]string  `json:"labels,omitempty"`
	Annotations map[string]string  `json:"annotations,omitempty"`
}
