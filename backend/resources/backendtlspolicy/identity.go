/*
 * backend/resources/backendtlspolicy/identity.go
 *
 * Built-in resource identity for BackendTLSPolicy (namespaced).
 */

package backendtlspolicy

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the BackendTLSPolicy identity (namespaced).
var Identity = resourcekind.Identity{
	Group:      "gateway.networking.k8s.io",
	Version:    "v1",
	Kind:       "BackendTLSPolicy",
	Resource:   "backendtlspolicies",
	Namespaced: true,
}
