# Resource Kind Registry Contract

Each built-in Kubernetes kind is defined in exactly one place. Every subsystem
that needs per-kind behavior loops a single registry and derives what it needs;
no subsystem spells out kind names for dispatch.

## Agent Contract

- A kind declares itself once: `resources/<kind>/identity.go` (its
  `resourcekind.Identity`) and `resources/<kind>/descriptor.go` (its
  `kindspec.Descriptor`, bundling identity + every typed facet). It is registered
  once, as one entry in `kindregistry.All`.
- Adding or changing a kind must not require edits outside `resources/<kind>/`
  and that one registry entry. If a dispatch path forces you to name a kind
  elsewhere, fix the generic mechanism instead of adding a special case.
- Subsystems dispatch by looping/deriving from `kindregistry`, never by
  hardcoding kind names: object catalog (informer/list/watch), resource-stream,
  snapshot stream-summary, object-map (collectors + edges), App bindings +
  generated detail dispatch, and response-cache invalidation.
- `resourcekind.Identity` is a dependency-free leaf — it must import nothing else
  in the repo. This is load-bearing: it lets `resourcecontract` and every kind
  package use the type without an import cycle. Do not add repo imports to it.
- The per-kind descriptor vocabulary (`backend/kind/*`) is consumed backend-wide
  (all `resources/<kind>`, the object catalog, generated bindings). It is a leaf
  family: it must not live under, or depend on, a consuming subsystem such as
  `refresh/`. The descriptor aggregates facets from several concerns (catalog,
  streaming, object-map, detail, operations), so it sits above all of them.
- Treat `builtin-resource-identities.json` and `kindregistry.All` as contracts:
  unknown or duplicate entries must fail a test, not degrade silently.

## Package Families

Two top-level families. Keep them distinct; do not merge their concerns.

- **Identity & contract** — what kinds exist.
  - `backend/resourcekind` — the shared `Identity` leaf (group/version/kind +
    resource + scope), declared once per kind.
  - `backend/resourcecontract` — aggregates per-kind identities into the
    authoritative built-in table (`BuiltinResources`), authored alongside
    `builtin-resource-identities.json`.
- **Descriptor vocabulary** (`backend/kind/`) — how each kind behaves.
  - `kind/kindspec` — the per-kind `Descriptor` (identity + facets).
  - `kind/kindregistry` — `All`, the list of descriptors every subsystem loops.
  - `kind/streamspec`, `kind/streamrows` — streaming row descriptor + row DTOs.
  - `kind/objectmapnode`, `kind/objectmapspec`, `kind/objectmap` — object-map
    collector, edge declarations, and neutral node status/action facts.

`CatalogSource` is also the catalog-participation boundary. `CatalogNone` keeps
high-churn or separately managed kinds such as Event out of the general object
catalog while allowing their detail binding, cache invalidation, and other
facets to remain registry-driven.

`backend/resourcemodel` is a separate concern (object refs, status, facts, and
relationship links) — see [shared-resource-model.md](shared-resource-model.md).

## Sanctioned Exceptions

A subsystem may name a kind only when the kind name *is* the data, not a
dispatch shortcut: legitimate cross-kind relationships (e.g. a workload→ConfigMap
edge), per-kind operations (scale/rollback/port-forward), the documented bespoke
streaming paths (workload metrics, HPA), Go type switches over shared leaf types,
and tests. New occurrences outside these categories are a contract violation.

## Starting Points

- Identity leaf: `backend/resourcekind/identity.go`
- Built-in table: `backend/resourcecontract/builtin_resources.go`
- Descriptor shape: `backend/kind/kindspec/descriptor.go`
- The registry: `backend/kind/kindregistry/registry.go`
- A representative kind: `backend/resources/deployment/{identity,descriptor}.go`

## Validation

- `backend/kind/kindregistry/registry_test.go` — registry well-formedness.
- `backend/resourcecontract/builtin_identity_sourcing_test.go` — every table row
  is sourced from a kind's `Identity`, not a restated literal.
- `backend/refresh/snapshot/registry_drift_test.go`,
  `backend/objectcatalog/informer_registry_test.go`,
  `backend/response_cache_invalidation_registry_test.go` — each dispatch surface
  stays registry-driven.
- Done-test: grep any kind name; it should appear only in its own package, the
  single `kindregistry.All` entry, and the sanctioned exceptions above.
- Run `mage qc:prerelease` after any change to these packages.
