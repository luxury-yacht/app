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
- Registry-driven surfaces: object catalog (ingest collection and sinks),
  resource-stream, snapshot stream-summary, object-map (collectors + edges), App
  bindings + generated detail dispatch, response-cache invalidation, container-log
  targets (`kindregistry.LogTargets`), and the frontend kind facets table.
- Frontend kind facets: `go generate ./backend` writes
  `frontend/src/shared/kinds/kindFacets.generated.ts` (`internal/genkindfacets`)
  with one row per registered kind. It carries every per-kind decision the
  frontend makes: panel tabs (`Panel`), the logs source (`Logs` /
  `Panel.NodeLogs`), the metrics domain (`Metrics`), action eligibility, object-map
  support, the list domain (`Stream.Domain` or `ListDomain`), and display names
  (`Display`). The frontend reads it through `shared/kinds/kindFacets`:
  `lookupKindFacets` (exact group, a served version, kind in any case) for
  behavior, `lookupKindMetadata` (group and kind) for display names and list
  navigation. Never add a frontend per-kind table or kind-name branch; add or
  change the facet. Sections that read a DTO because of a facet are mapped types
  over `DetailTypesWhere<…>`, so TypeScript rejects a missing or stale accessor.
  Display-only frontend tables (badge colors, Overview layouts) are the
  exception and stay presentation.
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
  - `logspec`: the container-log target a kind declares (`Descriptor.Logs`):
    how to find its pods and the watch that follows them. A leaf, so kind
    packages and `internal/containerlogs` share it.
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
  `backend/objectcatalog/catalog_source_test.go`,
  `backend/response_cache_invalidation_registry_test.go`: each dispatch surface
  stays registry-driven.
- `backend/internal/genkindfacets/render_test.go` (every facet for every kind,
  today's decisions pinned), `backend/kind_facets_test.go` (generated file current;
  every listed version passes the backend's target checks), and the agreement
  tests in `backend/refresh/snapshot/kind_facets_agreement_test.go` (pods by
  owner/node, metrics and list domains) and
  `backend/internal/containerlogs/kind_facets_agreement_test.go` (log targets).
- Done-test: a grep for any kind name hits only its own package, its
  `kindregistry.All` entry, and the sanctioned exceptions.
