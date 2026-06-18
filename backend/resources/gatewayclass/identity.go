/*
 * backend/resources/gatewayclass/identity.go
 *
 * Built-in resource identity for GatewayClass (cluster-scoped). Declared with the
 * shared resourcekind.Identity type (no resourcecontract import) so the contract
 * can aggregate it.
 */

package gatewayclass

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the GatewayClass identity (cluster-scoped).
var Identity = resourcekind.Identity{
	Group:      "gateway.networking.k8s.io",
	Version:    "v1",
	Kind:       "GatewayClass",
	Resource:   "gatewayclasses",
	Namespaced: false,
}
