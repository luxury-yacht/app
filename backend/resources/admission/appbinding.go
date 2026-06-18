package admission

import "github.com/luxury-yacht/app/backend/resources/appbinding"

// MutatingDetailBinding and ValidatingDetailBinding declare the two admission
// webhook App.Get bindings for the genappbindings generator. Both resolve through
// admission.NewService; their identities differ only in kind.
var (
	MutatingDetailBinding = appbinding.Spec{
		Identity: MutatingIdentity,
		Service:  "admission.NewService(deps)",
		Import:   "github.com/luxury-yacht/app/backend/resources/admission",
	}
	ValidatingDetailBinding = appbinding.Spec{
		Identity: ValidatingIdentity,
		Service:  "admission.NewService(deps)",
		Import:   "github.com/luxury-yacht/app/backend/resources/admission",
	}
)
