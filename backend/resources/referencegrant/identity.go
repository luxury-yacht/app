/*
 * backend/resources/referencegrant/identity.go
 *
 * Built-in resource identity for ReferenceGrant (namespaced).
 */

package referencegrant

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the ReferenceGrant identity (namespaced).
var Identity = resourcekind.Identity{
	Group:      "gateway.networking.k8s.io",
	Version:    "v1",
	Kind:       "ReferenceGrant",
	Resource:   "referencegrants",
	Namespaced: true,
}
