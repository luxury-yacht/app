/*
 * backend/resources/httproute/identity.go
 *
 * Built-in resource identity for HTTPRoute (namespaced).
 */

package httproute

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the HTTPRoute identity (namespaced).
var Identity = resourcekind.Identity{
	Group:      "gateway.networking.k8s.io",
	Version:    "v1",
	Kind:       "HTTPRoute",
	Resource:   "httproutes",
	Namespaced: true,
}
