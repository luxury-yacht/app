/*
 * backend/resources/admission/identity.go
 *
 * Built-in resource identities for the admission webhook-configuration pair.
 * This package serves two kinds (Mutating + Validating), so it declares two
 * identities. Declared with the shared resourcekind.Identity type (no
 * resourcecontract import) so resourcecontract can aggregate them.
 */

package admission

import "github.com/luxury-yacht/app/backend/resourcekind"

// MutatingIdentity is the MutatingWebhookConfiguration identity (cluster-scoped).
var MutatingIdentity = resourcekind.Identity{
	Group:      apiGroup,
	Version:    "v1",
	Kind:       "MutatingWebhookConfiguration",
	Resource:   "mutatingwebhookconfigurations",
	Namespaced: false,
}

// ValidatingIdentity is the ValidatingWebhookConfiguration identity (cluster-scoped).
var ValidatingIdentity = resourcekind.Identity{
	Group:      apiGroup,
	Version:    "v1",
	Kind:       "ValidatingWebhookConfiguration",
	Resource:   "validatingwebhookconfigurations",
	Namespaced: false,
}
