# Resource Kind Registry Contract

Each built-in Kubernetes kind is defined in exactly one place. Every subsystem
that needs per-kind behavior loops a single registry and derives what it needs;
no subsystem spells out kind names for dispatch.

## Agent Contract

- A kind declares itself once: `resources/<kind>/identity.go` (its
  `resourcekind.Identity`) and `resources/<kind>/descriptor.go` (its
  `kindspec.Descriptor`: identity plus every typed facet), registered as one
  entry in `kindregistry.All`.
- Adding or changing a kind edits only `resources/<kind>/` and that entry. If a
  dispatch path forces you to name a kind elsewhere, fix the generic mechanism.
- Registry-driven surfaces: object catalog (informer/list/watch),
  resource-stream, snapshot stream-summary, object-map (collectors + edges), App
  bindings + generated detail dispatch, and response-cache invalidation.
- `resourcekind.Identity` is a dependency-free leaf that imports nothing else in
  the repo, so `resourcecontract` and every kind package use it without import
  cycles. Do not add repo imports to it.
- The descriptor vocabulary (`backend/kind/*`) is consumed backend-wide and
  aggregates facets from catalog, streaming, object-map, detail, and operations,
  so it sits above all of them: it must not live under, or depend on, a
  consuming subsystem such as `refresh/`.
- `builtin-resource-identities.json` and `kindregistry.All` are contracts:
  unknown or duplicate entries fail a test, never degrade silently.
- `CatalogSource` is the catalog-participation boundary. `CatalogNone` keeps
  high-churn or separately managed kinds such as Event out of the general object
  catalog while their detail binding, cache invalidation, and other facets stay
  registry-driven.

## Package Families

Keep the two families distinct. `backend/resourcemodel` (refs, status, facts,
links) is a separate concern: [shared-resource-model.md](shared-resource-model.md).

- **Identity & contract** — what kinds exist.
  - `backend/resourcekind`: the shared `Identity` leaf (group/version/kind,
    resource, scope).
  - `backend/resourcecontract`: aggregates per-kind identities into the
    authoritative `BuiltinResources` table, authored alongside
    `builtin-resource-identities.json`.
- **Descriptor vocabulary** (`backend/kind/`) — how each kind behaves.
  - `kindspec`: the per-kind `Descriptor`; `kindregistry`: `All`.
  - `streamspec`, `streamrows`: streaming row descriptor and row DTOs.
  - `objectmapnode`, `objectmapspec`, `objectmap`: object-map collector, edge
    declarations, and neutral node status/action facts.

## Sanctioned Exceptions

A subsystem may name a kind only when the kind name *is* the data, not a
dispatch shortcut: cross-kind relationships (e.g. a workload→ConfigMap edge),
per-kind operations (scale/rollback/port-forward), the documented bespoke
streaming paths (workload metrics, HPA), Go type switches over shared leaf
types, and tests. Any other new occurrence violates this contract.

## Starting Points and Proof

- Identity leaf: `backend/resourcekind/identity.go`; built-in table:
  `backend/resourcecontract/builtin_resources.go`; descriptor shape:
  `backend/kind/kindspec/descriptor.go`; registry:
  `backend/kind/kindregistry/registry.go`; representative kind:
  `backend/resources/deployment/{identity,descriptor}.go`.
- `backend/kind/kindregistry/registry_test.go`: registry well-formedness.
- `backend/resourcecontract/builtin_identity_sourcing_test.go`: every table row
  is sourced from a kind's `Identity`, not a restated literal.
- `backend/refresh/snapshot/registry_drift_test.go`,
  `backend/objectcatalog/informer_registry_test.go`,
  `backend/response_cache_invalidation_registry_test.go`: each dispatch surface
  stays registry-driven.
- Done-test: a grep for any kind name hits only its own package, its
  `kindregistry.All` entry, and the sanctioned exceptions.
