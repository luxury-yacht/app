# Shared Resource Model Contract

The backend shared resource model owns Kubernetes object identity, primary
status, durable facts, and relationship links. Frontend code consumes projected
DTO fields; it does not reinterpret primary resource semantics.

## Agent Contract

- Object references crossing package, API, cache, event, action, refresh, or
  navigation boundaries must carry `clusterId`, `group`, `version`, and `kind`.
  Concrete objects also need `namespace` when namespaced and `name`.
- Backend code owns primary status semantics and `statusPresentation`.
- Frontend code renders backend status fields and may only map presentation
  tokens to CSS at the edge.
- Relationship links use `resourcemodel.ResourceLink`. Openable links contain a
  complete `ref`; display-only links contain `display`. Do not emit hybrids.
- Do not guess `apiVersion`, API group, plural resource, or scope from `kind`.
  Use typed sources, discovery, owner refs, event involved objects, Helm
  manifests, or catalog lookup.
- Resource-specific facts should stay typed. Do not add generic fact buckets or
  empty future slots.
- Sensitive or large payloads such as raw YAML, Secret data, logs, manifests,
  and shell output stay in workflow/detail DTOs, not shared facts.

## Use The Model For

- namespace and cluster table rows
- resource-stream rows
- object-panel summaries and overviews
- object-map nodes and edges
- event involved-object links
- Helm release summaries and managed-resource links
- dynamic custom-resource status extraction when conventions are tested

Do not force settings, auth, app logs, refresh diagnostics, runtime operations,
port-forward sessions, shell IO, node drain history, or raw workflow tabs into
the shared resource model unless they are rendering Kubernetes resource
semantics.

## Identity

Canonical refs include:

```text
clusterId
group
version
kind
namespace  # when namespaced
name       # when concrete
```

The Kubernetes plural `resource` is descriptor/RBAC metadata. Populate it only
when discovery, typed code, or the catalog supplies it.

Synthetic app resources still need stable identity. Helm releases use
`helm.sh/v3`, `HelmRelease`.

## Status

Projected DTO status fields:

- `status`: display label
- `statusState`: raw/source state for diagnostics and parity checks
- `statusPresentation`: CSS/status presentation token
- `statusReason`: optional source reason

Missing `statusPresentation` should render as `unknown` so incomplete backend
projection is visible. `statusState` is source state, not a styling fallback.
Deletion lifecycle from `metadata.deletionTimestamp` takes precedence over
reason-derived labels while preserving source state.

When migrating a resource family, project status consistently into every surface
that renders it: snapshot rows, stream rows, rich detail DTOs, object-map data,
and object-panel overview data. Then remove duplicated frontend or service-layer
status interpretation on that path.

## Links

Use shared constructors and validators in `backend/resourcemodel`:

- `NewResourceRef`
- `NewNamespacedResourceLink`
- `NewClusterResourceLink`
- `NewDisplayResourceLink`
- `NewDisplayRef`
- `ValidateResourceLink`

Projection helpers live in `backend/resources/types`. They intentionally do not
infer `resource` from `kind`.

Openable refs are allowed only when the source provides complete identity.
External, stale, deleted, custom-group, or partial references should remain
display-only unless catalog lookup can safely resolve them.

## Ownership

- Semantic model, facts, status, and links: `backend/resourcemodel`
- Refresh/table/object-map projections: `backend/refresh/snapshot`
- Rich detail DTO projections: `backend/resources`, `backend/resources/types`
- Catalog identity/existence: `backend/objectcatalog`
- Frontend status rendering: `frontend/src/shared/utils/backendStatusPresentation.ts`
- Frontend link navigation: `frontend/src/shared/utils/resourceLinkIdentity.ts`

## Change Checklist

When changing resource semantics:

1. Start from Kubernetes API semantics, not current DTO display strings.
2. Preserve full object identity and avoid kind-only fallbacks.
3. Put durable resource semantics in typed facts.
4. Keep raw, large, sensitive, or workflow-specific data out of shared facts.
5. Project status and links across all affected surfaces.
6. Remove duplicate status/link derivation from migrated frontend/backend paths.
7. Add parity tests for DTO projections and relationship navigation.

## Validation

Run focused `backend/resourcemodel`, snapshot, detail DTO, and affected frontend
tests. For non-documentation work, finish with `mage qc:prerelease`.
