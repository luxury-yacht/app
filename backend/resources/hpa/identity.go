/*
 * backend/resources/hpa/identity.go
 *
 * HorizontalPodAutoscaler's built-in resource identities, owned by the kind's
 * package. Declared with the shared resourcekind.Identity type (no
 * resourcecontract import) so resourcecontract can aggregate them. The contract
 * lists HPA under both served versions: v2 is the primary version, and v1 is
 * the secondary served identity. Both are owned here.
 */

package hpa

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the HorizontalPodAutoscaler v2 built-in resource identity (the
// primary served version, namespaced).
var Identity = resourcekind.Identity{
	Group:      "autoscaling",
	Version:    "v2",
	Kind:       "HorizontalPodAutoscaler",
	Resource:   "horizontalpodautoscalers",
	Namespaced: true,
}

// IdentityV1 is the HorizontalPodAutoscaler v1 built-in resource identity (the
// secondary served version, namespaced).
var IdentityV1 = resourcekind.Identity{
	Group:      "autoscaling",
	Version:    "v1",
	Kind:       "HorizontalPodAutoscaler",
	Resource:   "horizontalpodautoscalers",
	Namespaced: true,
}
