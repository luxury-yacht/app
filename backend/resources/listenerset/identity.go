/*
 * backend/resources/listenerset/identity.go
 *
 * Built-in resource identity for ListenerSet (namespaced).
 */

package listenerset

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the ListenerSet identity (namespaced).
var Identity = resourcekind.Identity{
	Group:      "gateway.networking.k8s.io",
	Version:    "v1",
	Kind:       "ListenerSet",
	Resource:   "listenersets",
	Namespaced: true,
}
