// Package appbinding defines the per-kind App.Get<Kind> detail-binding
// declaration. Each kind package declares one Spec; the genappbindings generator
// aggregates them (like the stream registry) and emits the App.Get wrappers and
// the object-panel detail-fetcher dispatch map. Putting the Spec in the kind
// package means adding or changing a binding is a one-package edit.
package appbinding

import "github.com/luxury-yacht/app/backend/resourcekind"

// Spec is one kind's detail binding. Identity is the single source of the kind
// name (the App method is Get<Kind>, the DTO is <Kind>Details) and whether it is
// namespaced — no second copy. The remaining fields are codegen metadata for the
// typed service call.
type Spec struct {
	Identity  resourcekind.Identity
	Key       string // fetch selection key (default Identity.Kind)
	Method    string // service method (default Identity.Kind)
	Service   string // service constructor expression, e.g. "deployment.NewService(deps)"
	Import    string // service package import path
	DTOImport string // DTO package import (default Import — DTO shares the service package)
	Fetch     string // raw detail-fetch expression override (hand-written bindings only)
}
