/*
 * backend/resources/grpcroute/identity.go
 *
 * Built-in resource identity for GRPCRoute (namespaced).
 */

package grpcroute

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the GRPCRoute identity (namespaced).
var Identity = resourcekind.Identity{
	Group:      "gateway.networking.k8s.io",
	Version:    "v1",
	Kind:       "GRPCRoute",
	Resource:   "grpcroutes",
	Namespaced: true,
}
