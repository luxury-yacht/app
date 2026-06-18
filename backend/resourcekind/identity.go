/*
 * backend/resourcekind/identity.go
 *
 * The single shared shape every kind package uses to declare its built-in
 * Kubernetes resource identity. This package is a leaf: it imports nothing else
 * in the repo, so each resources/<kind> package can declare its Identity with
 * this type while resourcecontract aggregates them all without an import cycle.
 *
 * This is the foundational facet of the per-kind descriptor; the contract is in
 * docs/architecture/resource-kind-registry.md. Identity is declared once per
 * kind, and a kindspec.Descriptor bundles the rest (model, summary, detail,
 * object-map, permissions) so each kind is defined in exactly one place.
 */

package resourcekind

// Identity is the group/version/kind + resource + scope identity of one built-in
// Kubernetes resource. A kind package declares a value of this type once; every
// subsystem reads the kind from that single declaration instead of restating it.
type Identity struct {
	Group      string
	Version    string
	Kind       string
	Resource   string
	Namespaced bool
}
