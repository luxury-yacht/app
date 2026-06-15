/*
 * backend/resources/clusterrole/dto.go
 *
 * ClusterRole detail DTOs (the frontend wire shape). PolicyRule + ObjectRef are
 * shared primitives that stay in resources/types; AggregationRule is ClusterRole-
 * only and owned here.
 */

package clusterrole

import restypes "github.com/luxury-yacht/app/backend/resources/types"

type ClusterRoleDetails struct {
	Kind                string                `json:"kind"`
	Name                string                `json:"name"`
	Age                 string                `json:"age"`
	Details             string                `json:"details"`
	Rules               []restypes.PolicyRule `json:"rules"`
	AggregationRule     *AggregationRule      `json:"aggregationRule,omitempty"`
	Labels              map[string]string     `json:"labels,omitempty"`
	Annotations         map[string]string     `json:"annotations,omitempty"`
	ClusterRoleBindings []restypes.ObjectRef  `json:"clusterRoleBindings,omitempty"`
	RoleBindings        []restypes.ObjectRef  `json:"roleBindings,omitempty"`
}

type AggregationRule struct {
	ClusterRoleSelectors []map[string]string `json:"clusterRoleSelectors,omitempty"`
}
