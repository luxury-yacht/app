/*
 * backend/resources/tlsroute/identity.go
 *
 * Built-in resource identity for TLSRoute (namespaced).
 */

package tlsroute

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the TLSRoute identity (namespaced).
var Identity = resourcekind.Identity{
	Group:      "gateway.networking.k8s.io",
	Version:    "v1",
	Kind:       "TLSRoute",
	Resource:   "tlsroutes",
	Namespaced: true,
}
