/*
 * backend/resources/role/dto.go
 *
 * Role detail DTO (the frontend wire shape). PolicyRule + ObjectRef sub-types are
 * shared primitives that stay in resources/types.
 */

package role

import restypes "github.com/luxury-yacht/app/backend/resources/types"

type RoleDetails struct {
	Kind               string                `json:"kind"`
	Name               string                `json:"name"`
	Namespace          string                `json:"namespace"`
	Age                string                `json:"age"`
	Details            string                `json:"details"`
	Rules              []restypes.PolicyRule `json:"rules"`
	Labels             map[string]string     `json:"labels,omitempty"`
	Annotations        map[string]string     `json:"annotations,omitempty"`
	UsedByRoleBindings []restypes.ObjectRef  `json:"usedByRoleBindings,omitempty"`
}
