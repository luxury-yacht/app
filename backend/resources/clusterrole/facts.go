/*
 * backend/resources/clusterrole/facts.go
 *
 * Canonical ClusterRole facts. Rules reference the shared PolicyRuleFacts primitive
 * (resourcemodel); AggregationRuleFacts is ClusterRole-only and owned here; the
 * binding links are reverse links from the shared relationship index.
 */

package clusterrole

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Facts is the canonical ClusterRole model facts.
type Facts struct {
	Rules               []resourcemodel.PolicyRuleFacts `json:"rules,omitempty"`
	AggregationRule     *AggregationRuleFacts           `json:"aggregationRule,omitempty"`
	ClusterRoleBindings []resourcemodel.ResourceLink    `json:"clusterRoleBindings,omitempty"`
	RoleBindings        []resourcemodel.ResourceLink    `json:"roleBindings,omitempty"`
}

// AggregationRuleFacts is the ClusterRole-only aggregation selector facts.
type AggregationRuleFacts struct {
	ClusterRoleSelectors []map[string]string `json:"clusterRoleSelectors,omitempty"`
}
