/*
 * backend/resources/serviceaccount/dto.go
 *
 * ServiceAccount detail DTO (the frontend wire shape). ObjectRef is a shared
 * primitive that stays in resources/types.
 */

package serviceaccount

import restypes "github.com/luxury-yacht/app/backend/resources/types"

type ServiceAccountDetails struct {
	Kind                         string               `json:"kind"`
	Name                         string               `json:"name"`
	Namespace                    string               `json:"namespace"`
	Age                          string               `json:"age"`
	Details                      string               `json:"details"`
	Secrets                      []restypes.ObjectRef `json:"secrets,omitempty"`
	ImagePullSecrets             []restypes.ObjectRef `json:"imagePullSecrets,omitempty"`
	AutomountServiceAccountToken *bool                `json:"automountServiceAccountToken,omitempty"`
	Labels                       map[string]string    `json:"labels,omitempty"`
	Annotations                  map[string]string    `json:"annotations,omitempty"`
	UsedByPods                   []restypes.ObjectRef `json:"usedByPods,omitempty"`
	RoleBindings                 []restypes.ObjectRef `json:"roleBindings,omitempty"`
	ClusterRoleBindings          []restypes.ObjectRef `json:"clusterRoleBindings,omitempty"`
}
