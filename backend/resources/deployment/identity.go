/*
 * backend/resources/deployment/identity.go
 *
 * Deployment's built-in resource identity, owned by the kind's package.
 * Plain struct (no resourcecontract import) so resourcecontract can aggregate it.
 */

package deployment

// Identity is the Deployment built-in resource identity.
var Identity = struct {
	Group      string
	Version    string
	Kind       string
	Resource   string
	Namespaced bool
}{
	Group:      "apps",
	Version:    "v1",
	Kind:       "Deployment",
	Resource:   "deployments",
	Namespaced: true,
}
