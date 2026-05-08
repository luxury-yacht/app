# Shared Resource Model Contracts

The shared resource model is the backend source of truth for Kubernetes object
identity, primary status, relationship links, and reverse-link materialization.
New resource work must follow these rules before adding frontend interpretation
or parallel DTO shapes.

The implementation lives primarily in:

- `backend/resourcemodel` for semantic builders, facts, status, links, and
  validation
- `backend/refresh/snapshot` for refresh, table, stream, and object-map
  projections
- `backend/resources` and `backend/resources/types` for projections into
  existing rich-detail DTO contracts
- `frontend/src/shared/utils/backendStatusPresentation.ts` for status CSS token
  selection
- `frontend/src/shared/utils/resourceLinkIdentity.ts` for frontend relationship
  navigation and catalog-backed reference resolution

The full migration plan and phase history are in
`docs/plans/shared-resource-model.md`. This document is the standing contract
for new work.

## Scope

The shared resource model owns Kubernetes resource semantics. It should be used
when code needs to decide what a Kubernetes object means: canonical identity,
primary status presentation, lifecycle, relationship links, and durable
resource-specific facts.

Use it for Kubernetes resource surfaces where applicable:

- namespace and cluster resource table rows
- resource-stream rows
- object-panel detail summaries and overview data
- object-map nodes, edges, and relationship references
- event involved-object links
- Helm release summary/status and manifest resource links
- dynamic custom-resource status extraction

The frontend should consume DTO fields projected from the shared model. Frontend
components do not import `backend/resourcemodel` directly; they render app-level
fields such as `status`, `statusState`, `statusPresentation`, and
`ResourceLink`.

The shared model is intentionally not the model for every app screen or
workflow. Do not force these surfaces through `backend/resourcemodel` unless
they are rendering Kubernetes resource semantics:

- Browse/catalog discovery views and backend object-catalog services. The
  object catalog remains the source of truth for what objects exist, GVK/GVR,
  scope, and exact catalog lookup.
- Cluster overview aggregate health, counts, capacity, usage, and summary
  charts.
- Refresh diagnostics, stream health, broker-read diagnostics, and telemetry.
- Settings, kubeconfig selection, app lifecycle, app logs, auth, update, and
  persistence screens.
- Raw or workflow-specific object-panel tabs such as YAML, logs, shell, node
  logs, Helm manifest, and Helm values. These may use shared identity or links
  where useful, but their payloads remain workflow-specific.
- Port-forward sessions, shell sessions, node maintenance, drain progress,
  workload actions, rollback, scale, delete, and other operation state.
- Capability and permission models. Those depend on RBAC, discovery, action
  options, selected cluster, and in-flight operations, so they stay contextual
  and separate from intrinsic resource facts.

## Identity

Every object reference that crosses a package, API, cache, event, action,
navigation, or refresh boundary must carry:

- `clusterId`
- `group`
- `version`
- `kind`
- `namespace` and `name` when the reference points to a concrete object

Do not pass kind-only, name-only, or namespace/name-only references. For
built-ins, resolve the real group/version from the built-in mapping. For CRDs,
thread the actual group/version from discovery, owner references, HPA targets,
event involved objects, CRDs, Helm manifests, or the object catalog.

The Kubernetes plural `resource` field is useful descriptor metadata and is
required for RBAC permission attributes, but it must not be guessed from `kind`.
Populate it only when discovery, typed code, or the object catalog supplies it.
An empty Kubernetes `apiVersion` is unknown; do not silently treat it as core
`v1`.

Synthetic app resources must still use stable identity. Helm releases use the
shared synthetic identity `helm.sh/v3`, `HelmRelease`; lowercase legacy values
such as `helmrelease` are DTO compatibility details, not canonical identity.

## Status

The backend owns primary Kubernetes resource status semantics. Frontend code
renders these DTO fields directly:

- `status`: display label
- `statusState`: raw/source state for diagnostics and parity checks
- `statusPresentation`: CSS/status presentation token
- `statusReason`: optional source reason

Frontend code must not derive the primary status class from Kubernetes status
strings, phases, condition statuses, Helm status strings, or `statusState`.
Missing `statusPresentation` must render as `unknown`, which makes missing
backend projection visible during testing.

`statusState` preserves the selected Kubernetes source value. It is not an app
health vocabulary and is not a styling fallback. For example, Node uses
`True`/`False`/`Unknown` from the `NodeReady` condition, while a terminating
Node uses `statusPresentation: "terminating"` to make all frontend surfaces
render the deleting state consistently.

When migrating a resource family, project status from the shared model into
every DTO surface that renders that resource:

- refresh/table rows
- resource-stream rows
- rich detail DTOs
- object-map nodes or edges
- object-panel overview data

After migration, delete duplicated frontend or service-layer status
interpretation on those paths.

## Resource Links

Use `resourcemodel.ResourceLink` for relationship-bearing facts.

Openable links contain `ref` only. Display-only links contain `display` only.
Never emit both `ref` and `display` in the same `ResourceLink`; that is an
ambiguous hybrid.

Use openable `ref` only when the source has a complete object identity:
`clusterId`, `group`, `version`, `kind`, `namespace` when namespaced, and
`name`. Use display-only `display` for unresolved, external, stale, deleted, or
partial references. If the source does not even provide a kind and name, do not
emit a link.

Construct links through the shared constructors:

- `resourcemodel.NewNamespacedResourceLink`
- `resourcemodel.NewClusterResourceLink`
- `resourcemodel.NewDisplayResourceLink`
- `resourcemodel.NewResourceRef`
- `resourcemodel.NewDisplayRef`

Validate exported links with `resourcemodel.ValidateResourceLink` when adding a
new relationship-bearing builder. Projection into rich detail DTOs should use
`backend/resources/types` helpers:

- `types.RefOrDisplayFromResourceLink`
- `types.RefOrDisplaySliceFromResourceLinks`
- `types.ObjectRefFromResourceRef`
- `types.DisplayRefFromResourceDisplay`

The projection helpers intentionally do not infer `resource` from `kind`.

## Catalog Resolution

Object-catalog-backed lookup is allowed only when the source already provides
stable identity such as UID or a full GVK + namespace/name. Catalog resolution
must not guess group, version, or resource from kind.

Frontend relationship navigation should use
`frontend/src/shared/utils/resourceLinkIdentity.ts`. That helper:

- opens `ResourceLink.ref` values directly
- treats `ResourceLink.display` values as non-openable
- resolves catalog objects by UID only when UID and clusterId are present
- resolves exact catalog matches only when full GVK + name are present

Display-only links are intentionally not openable, even if a legacy flat DTO
field happens to contain a kind or name nearby. Do not fall through from a
display-only `ResourceLink` to older heuristic navigation.

## Capabilities

Capabilities are contextual, not intrinsic resource facts. Continue to route
actions through the existing permission/action infrastructure:

- stable action IDs from `OBJECT_ACTION_IDS`
- frontend `CapabilityDescriptor`
- backend `capabilities.PermissionQuery`
- existing SSRR/SSAR diagnostics and active-operation state

Do not add a second capability model beside that path. If a future resource
needs additional contextual capability data, extend the existing descriptor and
document the source of each field.

Capability IDs and Kubernetes authorization attributes are stable external
contracts for UI behavior and permission diagnostics. Preserve them when moving
resource facts into `backend/resourcemodel`.

## Relationship Indexes

Reverse relationships that feed shared facts belong in
`resourcemodel.ResourceRelationshipIndex`. Build the index once for the
available per-cluster snapshot or detail inputs, pass it into migrated builders,
and request reverse-link facts explicitly with `MaterializeReverseLinks`.

The object map may still own graph traversal, filtering, deduplication, and edge
layout, but it should consume shared `ResourceLink` facts instead of inventing
parallel relationship semantics.

New reverse-link work must account for:

- stale catalog data
- partial RBAC/list-watch failures
- resource stream invalidation
- cluster lifecycle and clusterId isolation

Do not add facts slots or relationship-index inputs ahead of the resource family
that consumes them.

## Materialization And Sensitive Data

Shared builders must not make every consumer pay to build detail-heavy facts.
Use explicit materialization options:

- summary/table paths should request summary facts only
- detail paths may request detail facts, child lists, or container templates
- relationship paths may request relationship facts
- reverse-link paths must request `MaterializeReverseLinks`

Keep sensitive and large fields out of summary facts and non-detail payloads.
Examples include Secret values, literal environment values, command and args
arrays, raw YAML/spec/status, Helm manifests and values, credential-like storage
parameters, and certificate/key material. Detail-only DTOs may continue to
expose data that an existing explicit workflow already surfaces.

## Adding Or Migrating A Resource Family

Follow this sequence for each resource family:

1. Add or update the `backend/resourcemodel` builder, facts, status, lifecycle,
   and relationship links.
2. Project from that model into the existing refresh, detail, stream, and
   object-map DTO contracts instead of introducing parallel wire types.
3. Use shared projection helpers for `ResourceLink` and status presentation.
4. Remove old duplicate semantic derivation from migrated backend and frontend
   paths.
5. Add parity tests that prove table/detail/object-map/stream surfaces agree on
   primary status and identity where those surfaces exist.
6. Mark the corresponding implementation-plan item complete in
   `docs/plans/shared-resource-model.md`.

New fact slots are allowed only when a migrated consumer reads them. Do not add
empty slots to reserve future space.
