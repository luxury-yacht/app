/*
 * backend/resources/role/facts.go
 *
 * Canonical Role facts. Rules reference the shared PolicyRuleFacts primitive that
 * stays in resourcemodel; UsedByRoleBindings is a reverse link from the shared
 * relationship index.
 */

package role

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Facts is the canonical Role model facts.
type Facts struct {
	Rules              []resourcemodel.PolicyRuleFacts `json:"rules,omitempty"`
	UsedByRoleBindings []resourcemodel.ResourceLink    `json:"usedByRoleBindings,omitempty"`
}
