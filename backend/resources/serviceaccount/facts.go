/*
 * backend/resources/serviceaccount/facts.go
 *
 * Canonical ServiceAccount facts. Secret/binding links reference the shared
 * ResourceLink primitive (resourcemodel); the usage and binding links are reverse
 * links from the shared relationship index.
 */

package serviceaccount

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Facts is the canonical ServiceAccount model facts.
type Facts struct {
	Secrets             []resourcemodel.ResourceLink `json:"secrets,omitempty"`
	ImagePullSecrets    []resourcemodel.ResourceLink `json:"imagePullSecrets,omitempty"`
	AutomountToken      *bool                        `json:"automountToken,omitempty"`
	UsedByPods          []resourcemodel.ResourceLink `json:"usedByPods,omitempty"`
	RoleBindings        []resourcemodel.ResourceLink `json:"roleBindings,omitempty"`
	ClusterRoleBindings []resourcemodel.ResourceLink `json:"clusterRoleBindings,omitempty"`
}
