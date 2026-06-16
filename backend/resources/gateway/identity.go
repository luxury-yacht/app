/*
 * backend/resources/gateway/identity.go
 *
 * Built-in resource identity for Gateway (namespaced).
 */

package gateway

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the Gateway identity (namespaced).
var Identity = resourcekind.Identity{
	Group:      "gateway.networking.k8s.io",
	Version:    "v1",
	Kind:       "Gateway",
	Resource:   "gateways",
	Namespaced: true,
}
