package backend

// Standard ResourceGateway.Get<Kind> resource-detail methods and the
// object-panel detail-fetcher dispatch map are both generated from the binding
// descriptor in internal/genappbindings. Regenerate with `go generate
// ./backend` after adding a kind (one descriptor row + its typed service
// method/DTO).
//go:generate go run ./internal/genappbindings/cmd -out resource_details_generated.go -fetchers-out object_detail_fetchers_generated.go

// Refresh HTTP DTOs and domain-to-payload mappings are backend-owned. Keep the
// existing frontend import boundary, but generate its wire types from Go. The
// authored JSON also generates the typed backend domain-policy table.
//go:generate go run ./internal/genrefreshcontracts/cmd -out ../frontend/src/core/refresh/types.generated.ts -go-policy-out refresh/domain/policy_generated.go

// Object-action ids, backend command names, permission templates, and labels are
// generated from the backend catalog.
//go:generate go run ./internal/genobjectactions/cmd -out ../frontend/src/shared/actions/objectActions.generated.ts

// The frontend's per-kind facets (tabs, logs/shell/metrics sources, object-map
// support, action eligibility) are generated from the kind registry.
//go:generate go run ./internal/genkindfacets/cmd -out ../frontend/src/shared/kinds/kindFacets.generated.ts
