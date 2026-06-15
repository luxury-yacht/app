/*
 * backend/resources/clusterrolebinding/facts.go
 *
 * Canonical ClusterRoleBinding facts. RoleRef + Subjects reference shared rbac
 * primitives that stay in resourcemodel (ResourceLink, SubjectFacts).
 */

package clusterrolebinding

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Facts is the canonical ClusterRoleBinding model facts.
type Facts struct {
	RoleRef  resourcemodel.ResourceLink   `json:"roleRef"`
	Subjects []resourcemodel.SubjectFacts `json:"subjects,omitempty"`
}
