/*
 * backend/resources/rolebinding/facts.go
 *
 * Canonical RoleBinding facts. RoleRef + Subjects reference shared rbac primitives
 * that stay in resourcemodel (ResourceLink, SubjectFacts).
 */

package rolebinding

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Facts is the canonical RoleBinding model facts.
type Facts struct {
	RoleRef  resourcemodel.ResourceLink   `json:"roleRef"`
	Subjects []resourcemodel.SubjectFacts `json:"subjects,omitempty"`
}
