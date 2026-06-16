/*
 * backend/resources/gatewayapi/identity.go
 *
 * Built-in resource identities for the Gateway API family. This grouped package
 * serves eight kinds, so it declares eight identities. Declared with the shared
 * resourcekind.Identity type (no resourcecontract import) so resourcecontract can
 * aggregate them. Group is the shared gateway.networking.k8s.io const.
 */

package gatewayapi

import "github.com/luxury-yacht/app/backend/resourcekind"

// GatewayIdentity is the Gateway identity (namespaced).
var GatewayIdentity = resourcekind.Identity{
	Group:      Group,
	Version:    "v1",
	Kind:       "Gateway",
	Resource:   "gateways",
	Namespaced: true,
}

// HTTPRouteIdentity is the HTTPRoute identity (namespaced).
var HTTPRouteIdentity = resourcekind.Identity{
	Group:      Group,
	Version:    "v1",
	Kind:       "HTTPRoute",
	Resource:   "httproutes",
	Namespaced: true,
}

// GRPCRouteIdentity is the GRPCRoute identity (namespaced).
var GRPCRouteIdentity = resourcekind.Identity{
	Group:      Group,
	Version:    "v1",
	Kind:       "GRPCRoute",
	Resource:   "grpcroutes",
	Namespaced: true,
}

// TLSRouteIdentity is the TLSRoute identity (namespaced).
var TLSRouteIdentity = resourcekind.Identity{
	Group:      Group,
	Version:    "v1",
	Kind:       "TLSRoute",
	Resource:   "tlsroutes",
	Namespaced: true,
}

// ListenerSetIdentity is the ListenerSet identity (namespaced).
var ListenerSetIdentity = resourcekind.Identity{
	Group:      Group,
	Version:    "v1",
	Kind:       "ListenerSet",
	Resource:   "listenersets",
	Namespaced: true,
}

// BackendTLSPolicyIdentity is the BackendTLSPolicy identity (namespaced).
var BackendTLSPolicyIdentity = resourcekind.Identity{
	Group:      Group,
	Version:    "v1",
	Kind:       "BackendTLSPolicy",
	Resource:   "backendtlspolicies",
	Namespaced: true,
}

// ReferenceGrantIdentity is the ReferenceGrant identity (namespaced).
var ReferenceGrantIdentity = resourcekind.Identity{
	Group:      Group,
	Version:    "v1",
	Kind:       "ReferenceGrant",
	Resource:   "referencegrants",
	Namespaced: true,
}

// GatewayClassIdentity is the GatewayClass identity (cluster-scoped).
var GatewayClassIdentity = resourcekind.Identity{
	Group:      Group,
	Version:    "v1",
	Kind:       "GatewayClass",
	Resource:   "gatewayclasses",
	Namespaced: false,
}
