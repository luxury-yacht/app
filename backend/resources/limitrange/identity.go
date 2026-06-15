/*
 * backend/resources/limitrange/identity.go
 *
 * LimitRange's built-in resource identity, owned by the kind's package.
 */

package limitrange

// Identity is the LimitRange built-in resource identity.
var Identity = struct {
	Group      string
	Version    string
	Kind       string
	Resource   string
	Namespaced bool
}{
	Group:      "",
	Version:    "v1",
	Kind:       "LimitRange",
	Resource:   "limitranges",
	Namespaced: true,
}
