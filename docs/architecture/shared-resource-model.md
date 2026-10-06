# Shared Resource Model Contract

The backend shared resource model owns Kubernetes object identity, primary
status, durable facts, and relationship links. Frontend code consumes projected
DTO fields; it does not reinterpret primary resource semantics.

## Agent Contract

- Start from Kubernetes API semantics, not current DTO display strings.
- Never guess `apiVersion`, API group, plural resource, or scope from `kind`.
  Use typed sources, discovery, owner refs, event involved objects, HPA targets,
  Helm manifests, or catalog lookup.
- Keep resource-specific facts typed and semantic until the final DTO/table
  formatting boundary. No generic fact buckets or empty future slots.
- Raw YAML, Secret data, logs, manifests, shell output, and other sensitive or
  large payloads stay in workflow/detail DTOs, never in shared facts.
- Multi-kind table details are `resourcemodel.DetailSegment` lists (slot,
  label, value, optional `ResourceLink`, presentation token, and `Search`
  expansion for collapsed lists) built by each kind's stream-summary builder
  from typed facts, never a preformatted prose string. Slots
  (`DetailSlotReference`, `DetailSlotAddress`, `DetailSlotCounts`,
  `DetailSlotConfiguration`) map to the aligned frontend Context/Network/Summary
  columns; labels carry the kind-specific meaning. `DetailSegmentsSearchText`
  is the canonical search flatten (expanding collapsed lists); `DetailSlotText`
  is the per-slot sort flatten.
- Project a resource family's status and links into every surface that renders
  it (snapshot rows, stream rows, detail DTOs, object-map data, object-panel
  overview), then remove duplicated frontend or service-layer interpretation on
  that path. Parity tests cover DTO projections and relationship navigation.

## Use The Model For

Namespace and cluster table rows, resource-stream rows, object-panel summaries
and overviews, object-map nodes and edges, event involved-object links, Helm
release summaries and managed-resource links, and tested dynamic custom-resource
status extraction. Keep settings, auth, app logs, refresh diagnostics, runtime
operations, port-forward sessions, shell IO, node drain history, and raw
workflow tabs out unless they render Kubernetes resource semantics.

## Identity

- Canonical refs: `clusterId`, `group`, `version`, `kind`, plus `namespace`
  when namespaced and `name` when concrete.
- The plural `resource` is descriptor/RBAC metadata on the general
  `ResourceRef`; populate it only from discovery, typed code, or the catalog.
  Canonical snapshot, stream, catalog, and typed-query table row refs require
  both `resource` and `name` (their producers own a known GVR and a concrete
  object).
- Every concrete snapshot or stream row carries its identity in a backend-owned
  `ref` and never duplicates its own `clusterId`, group, version, kind,
  namespace, or name as flat fields. Backend query adapters and frontend table
  keys, filters, columns, navigation, panels, permissions, and actions consume
  `ref`; do not add another row-local GVK mapper. A flat identity-like field is
  allowed only with a different meaning (an Event's involved-object kind, a
  CRD's described API group, a Node's kubelet version).
- Shared row constructors use `streamrows.NewResourceRef`; resource-specific
  snapshot projectors copy the `BuildResourceModel(...).Ref` from the owning
  kind package.
- `ClusterMeta` is construction context and once-per-scope payload metadata;
  canonical rows never embed it. Cross-cluster displays resolve `clusterName`
  from the cluster workspace registry. Row keys derive from the complete ref,
  never from a second stored identity string.
- An Event row's `ref` identifies the Event; `involvedObject` links the resource
  it describes — never substitute one for the other. Synthetic resources keep
  stable identity: Helm rows use the synthetic release `ref` (`helm.sh/v3`,
  `HelmRelease`) under the same rule.
- The [Identities view](cluster-identities.md) holds observed subjects, not
  object rows. User/Group keys keep exact authentication names and carry no
  fabricated GVK; only source bindings and their roles carry object refs.
  User/Group panels use a distinct identity target in the shared panel registry,
  with a read-only binding view and no resource actions.

The canonical-row inventory is executable, not a handwritten frontend list:

- `backend/internal/genrefreshcontracts/canonical_rows.go` names the concrete Go
  row types; its reflection test rejects row-level `ClusterMeta` and duplicate
  own-identity fields.
- `frontend/src/test-fixtures/canonical-resource-row-wire.json` is built from the
  production row projectors. A Go test requires its family set to match the
  inventory exactly; a frontend test parses every refresh row through the
  `fetchSnapshot` envelope validator. Add a producer-marshaled entry for each new
  row family; never hand-build an optional JSON field to satisfy a frontend test.
- The custom catalog hydration row instead passes through its production RPC
  normalizer, including the cluster-scoped wire form that omits `namespace`.

### Frontend Reference Types

Frontend object references form a ladder; carry the narrowest type the boundary
allows:

- `KubernetesObjectReference` (`frontend/src/types/view-state.ts`): the loose
  pre-validation shape for raw payloads and heterogeneous link/row inputs. Every
  identity field is nullable; it must not leak past a validation boundary.
- `ResolvedObjectReference` (`frontend/src/shared/utils/objectIdentity.ts`): GVK
  and name required; built by `buildObjectReference`.
- `ClusterObjectReference` (same module): `clusterId` also required. Built by
  `buildRequiredObjectReference` / `buildRequiredRelatedObjectReference`, or
  narrowed in place by `assertObjectRefHasRequiredIdentity`, the single runtime
  chokepoint, called at `useObjectPanel.openWithObject`. The object-panel chain
  carries it end-to-end as `ObjectPanelRef` (an alias) from `openPanels` through
  `CurrentObjectPanelContext` to detail and utilization props; do not re-widen
  panel-internal types to the nullable shape.

Rules:

- Pre-chokepoint aggregation boundaries (`useNavigateToView`, `useObjectLink`,
  `ObjectPanelLink`, `useObjectActionController` inputs,
  `buildGridTableFocusRequest`) deliberately accept the loose type because they
  collect heterogeneous producers and their outputs enforce identity at runtime
  (focus requests require `clusterId`; panel opening asserts). Do not scatter
  the loose-to-required conversion into individual producers.
- `fallbackClusterId` is an explicit producer-side decision at cluster-scoped
  views; never bake a selected-cluster default into shared helpers.
- The assert preserves the original object so raw payload fields survive; refs
  narrowed in place may still hold `null` in optional fields, while builders
  normalize. Required fields are verified non-empty either way.

## Status

- Projected fields: `status` (display label), `statusState` (raw source state
  for diagnostics and parity), `statusPresentation` (CSS/status token), and
  optional `statusReason`.
- Backend model code computes primary status once. The frontend renders these
  fields and only maps presentation tokens to CSS at the edge.
- Missing `statusPresentation` renders as `unknown` so incomplete projection is
  visible; `statusState` is never a styling fallback.
- Deletion lifecycle from `metadata.deletionTimestamp` takes precedence over
  reason-derived labels while preserving source state.
- Namespace is the exception to metadata-only finalizer inspection:
  `ResourceLifecycle.FinalizerBlocked` also accounts for `spec.finalizers`, and
  Namespace `status.conditions` and `spec.finalizers` stay typed Namespace facts
  in its detail DTO. The object-details envelope carries kind-agnostic
  `metadata.deletionTimestamp` and `metadata.finalizers`; frontend deletion
  diagnostics combine them with the typed Namespace projection without
  reinterpreting lifecycle status.

Object Panel finalizer removal is offered only for objects with a deletion
timestamp and removes only the selected finalizer:

- Metadata finalizers use an exact-GVK JSON Patch guarded by a `test` operation,
  so a concurrent finalizer update is not overwritten; requires exact-object
  `patch`.
- Namespace `spec.finalizers` use the core/v1 Namespace `/finalize`
  subresource; requires `update namespaces/finalize`.
- Under five minutes after the deletion timestamp, the confirmation warns the
  user to give the responsible controller more cleanup time.

## Links

- Relationships use `resourcemodel.ResourceLink`. Openable links carry a
  complete `ref`; display-only links carry `display`. Never emit hybrids.
- Use the shared constructors and validators in `backend/resourcemodel`:
  `NewResourceRef`, `NewNamespacedResourceLink`, `NewClusterResourceLink`,
  `NewDisplayResourceLink`, `NewDisplayRef`, `ValidateResourceLink`. Projection
  helpers in `backend/resources/types` intentionally do not infer `resource`
  from `kind`.
- A link is openable only when its source provides complete identity. External,
  stale, deleted, custom-group, or partial references stay display-only unless
  catalog lookup can safely resolve them.

## Ownership

- Per-kind model, facts, and status: `backend/resources/<kind>/{model,facts}.go`,
  registered once in `backend/kind/kindregistry`
  ([resource-kind-registry.md](resource-kind-registry.md))
- Shared status/facts/link primitives and the relationship index:
  `backend/resourcemodel`
- Refresh/table/object-map projections: `backend/refresh/snapshot`
- Rich detail DTOs: `backend/resources/<kind>/{details,dto}.go`; shared
  cross-kind DTO field types in `backend/resources/types`
- Catalog identity/existence: `backend/objectcatalog` ([catalog.md](catalog.md))
- Frontend status rendering: `frontend/src/shared/utils/backendStatusPresentation.ts`
- Frontend link navigation: `frontend/src/shared/utils/resourceLinkIdentity.ts`
