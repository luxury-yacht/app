---
name: add-resource
description: Add support for a Kubernetes resource type by choosing the required catalog, refresh, detail, object-map, permission, frontend, docs, and test surfaces
---

# Add Resource

Add support for a Kubernetes resource type. Resource support can span several
surfaces; decide the required surfaces up front instead of assuming this is
only a rich-detail task.

This skill covers rich object detail/action support. If the resource also needs
to appear in a table or refresh-driven view, add a refresh-domain payload under
`backend/refresh/snapshot` and wire the matching frontend refresh domain. Do not
add new list/table payloads to `backend/resources`; that package is the
detail/action service layer.

## Resource Surface Matrix

Before editing code, decide which surfaces the resource needs:

| Surface                            | Backend Entry Points                                                                | Frontend Entry Points                                        | Notes                                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Discovery/catalog/browse           | `backend/objectcatalog`, `backend/refresh/snapshot/catalog.go`                      | `frontend/src/modules/browse`                                | The object catalog owns existence, GVK/GVR, scope, namespace listings, and cluster listings. |
| Refresh table/list                 | `backend/refresh/snapshot/*.go`, `backend/refresh/system/registrations.go`          | `frontend/src/core/refresh/*`, GridTable consumers           | Canonical list/table data belongs in refresh snapshots.                                      |
| Resource stream rows               | `backend/refresh/resourcestream`                                                    | `frontend/src/core/refresh/streaming`                        | Stream row shape must match snapshot row shape.                                              |
| Rich object details/actions        | `backend/resources/<kind>/` (`details.go`, `actions.go`, `dto.go`), generated detail bindings (`go generate ./backend`) | Object-panel details/overview registry                       | Use for detail tabs, logs/debug helpers, and imperative operations.                          |
| Per-kind identity/descriptor       | `backend/resources/<kind>/{identity,descriptor}.go`, one entry in `backend/kind/kindregistry`, identity row in `backend/resourcecontract` | n/a                                                          | Every subsystem loops the registry by facet; do not name the kind elsewhere.                 |
| Shared identity/status/links/facts | `backend/resources/<kind>/{model,facts}.go` built on shared primitives in `backend/resourcemodel` | status/link rendering utilities                              | Backend owns primary status and relationship semantics.                                      |
| YAML/edit/apply                    | object YAML/read/apply backend paths                                                | object-panel YAML tab                                        | Must carry clusterId and full GVK identity.                                                  |
| Object map                         | `.agents/skills/object-map/SKILL.md`, `backend/resources/<kind>/objectmap*.go`      | `frontend/src/modules/object-map`, object-panel support list | Fix backend graph data before frontend renderer/allowlist changes.                           |
| Permissions/capabilities           | refresh permission checks, capability backends                                      | RBAC-gated UI/action surfaces                                | Keep permission-denied diagnostics visible.                                                  |
| Docs/tests                         | owning architecture/workflow docs                                                   | adjacent specs/stories when useful                           | Update durable docs when contracts or supported kinds change.                                |

If the requested task only needs one surface, keep the implementation scoped to
that surface. If user-visible support would be incomplete without another
surface, explain the tradeoff before narrowing.

## Arguments

`/add-resource <Kind>` — e.g., `/add-resource CronJob`, `/add-resource Ingress`

## Before Starting

1. **Identify the resource's API group and identity.** Every built-in kind lives in its own package `backend/resources/<kind>/` (e.g. `deployment`, `service`, `configmap`). For rich object details/actions, create `backend/resources/<kind>/` (or extend it if it already exists). For table/list data, use `backend/refresh/snapshot` instead.
2. **Read the existing pattern.** Read one complete per-kind package end to end — `backend/resources/deployment/` is the canonical example (`identity.go`, `descriptor.go`, `appbinding.go`, `model.go`, `facts.go`, `dto.go`, `details.go`, `actions.go`, object-map files). Pick a neighbour that matches your resource's shape. Shared cross-kind helpers live in `backend/resources/workloads`, `backend/resources/common`, and `backend/resources/types`.
3. **Identify related resources.** Deployments relate to ReplicaSets and Pods. What does the new resource relate to? This determines what data the detail view should aggregate.
4. **Follow the shared resource model contracts.** Read `docs/architecture/shared-resource-model.md` before adding status, relationship links, capability checks, or object references. The backend owns status semantics; frontend status classes come from `statusPresentation`; relationship links use `resourcemodel.ResourceLink`; object references must carry `clusterId`, `group`, `version`, `kind`, and concrete object names.
   Do not guess `resource` from `kind`, and do not treat an empty Kubernetes
   `apiVersion` as core `v1`.
5. **Check refresh and frontend data contracts** if the resource appears in a
   table, stream, diagnostics panel, or object map. Read
   `docs/architecture/refresh-system.md`, `docs/architecture/data-access.md`,
   and `.agents/context/code-map.md`.

## Files to Create or Modify

### 1. Per-Kind Package, Identity & Descriptor — CREATE

**Directory:** `backend/resources/<kind>/`

A kind defines itself once in its own package and is registered once. Create
these files (see `backend/resources/deployment/` for the full shape):

- `identity.go` — `var Identity = resourcekind.Identity{Group, Version, Kind, Resource, Namespaced}`. This is the single source of the kind's GVK identity (`resourcekind` is a dependency-free leaf).
- `descriptor.go` — `var Descriptor = kindspec.Descriptor{Identity, CatalogSource, DetailCacheable, Stream, Collector, Edges, Binding, Graph, Workload, PortForward}`. Leave any facet nil/zero when the kind does not participate in that subsystem.
- `model.go` — `BuildResourceModel(clusterID, obj)`, `BuildFacts(obj)`, and `BuildStatusPresentation(obj)`, built from the shared primitives in `backend/resourcemodel` (e.g. `WorkloadResourceModel`, `WorkloadCommonFacts`, `ConditionFacts`, `ResourceLink`). Do not re-add per-kind files to `backend/resourcemodel`; it now holds only shared primitives + the relationship index.
- `facts.go` — the typed per-kind `Facts` struct. Keep facts semantic; do not add empty slots to reserve future space.

Then register the kind in exactly one place:

- Add one line — `<kind>.Descriptor` — to `var All` in `backend/kind/kindregistry/registry.go`.

Every subsystem (object catalog, resource-stream, snapshot stream-summary,
object-map, detail bindings, response-cache invalidation) loops that registry and
filters by facet. If a dispatch path forces you to name the kind elsewhere, fix
the generic mechanism instead of adding a special case. See
`docs/architecture/resource-kind-registry.md`.

- Populate canonical identity with `clusterId`, `group`, `version`, `kind`,
  `resource`, scope, namespace, and name.
- Represent relationships with `ResourceLink`; use display-only refs only when
  the source does not provide enough identity for safe navigation.
- Add adjacent tests in the kind package for status, facts, refs, and
  relationship behavior.
- Project from the model into detail DTOs, refresh rows, object-map nodes, or
  event/link payloads instead of reimplementing status or relationships in each
  consumer.

### 2. Backend Detail Service — CREATE or MODIFY

**File:** `backend/resources/<kind>/details.go`

Follow this pattern:

```go
package <kind>

import (
    "github.com/luxury-yacht/app/backend/resources/common"
    // k8s API imports for the resource
)

// Service provides detailed <Kind> views backed by shared dependencies.
type Service struct {
    deps common.Dependencies
}

// NewService constructs a <Kind> service using the supplied dependencies bundle.
func NewService(deps common.Dependencies) *Service {
    return &Service{deps: deps}
}

// <Kind> returns the detailed view for a single resource.
func (s *Service) <Kind>(namespace, name string) (*<Kind>Details, error) {
    client := s.deps.KubernetesClient
    if client == nil {
        return nil, fmt.Errorf("kubernetes client not initialized")
    }
    item, err := client.<APIGroup>().<Resources>(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
    if err != nil {
        return nil, fmt.Errorf("failed to get <kind>: %w", err)
    }
    model := BuildResourceModel(s.deps.ClusterID, item)
    facts := BuildFacts(item)
    // Fetch related resources, project the model's status/facts into the DTO,
    // and return display-ready details.
}
```

Key points:

- Accept `common.Dependencies` — never construct clients directly
- For namespaced resources, accept `(namespace, name string)`
- For cluster-scoped resources, accept `(name string)` only
- Aggregate related resources (pods, events, etc.) to build a rich detail view
- Use label selectors to find related pods when applicable
- Collect metrics via `s.deps.MetricsClient` when the resource manages pods
- Use `s.deps.Context` and `s.deps.ClusterID`; do not use
  `context.Background()` or unscoped identity in resource services
- Keep large/raw/sensitive/tab-specific payloads in detail-only DTO fields, but
  keep semantic status, refs, and durable facts in the kind's `model.go`/`facts.go`
  (built on the shared `backend/resourcemodel` primitives)

### 3. Detail DTO — CREATE

**File:** `backend/resources/<kind>/dto.go`

Add a `<Kind>Details` struct (the frontend wire shape, co-located with the kind's
model and detail builder). Include:

- Basic metadata: Kind, Name, Namespace, Age, Labels, Annotations
- Shared status projection fields when the resource has meaningful primary status.
  Embed `restypes.StatusProjection` (it carries `status`, `statusState`,
  `statusPresentation`, and `statusReason`).
- Resource-specific fields from the Kubernetes spec/status
- Related resource summaries (pods, events, etc.) — reuse shared field types from
  `backend/resources/types` (e.g. `restypes.PodSimpleInfo`)
- Computed display strings at the final DTO boundary only (e.g., "Ready: 2/3")

Look at `backend/resources/deployment/dto.go` for field naming conventions — DTOs
use plain strings for display values, not raw Kubernetes types. Shared cross-kind
field types stay in `backend/resources/types`; only the `<Kind>Details` struct
itself lives in the kind package.

If Go DTOs change, refresh or verify the Wails bindings in
`frontend/wailsjs/go/models.ts`. `wails generate` may not work in every local
run, so validate bindings with frontend typecheck.

### 4. Detail Binding (Generated Dispatch) — CREATE + REGENERATE

**File:** `backend/resources/<kind>/appbinding.go`

The `App.Get<Kind>` wrapper and the object-panel detail-fetcher dispatch map are
generated; you declare one binding spec, then regenerate. Do not hand-edit
`objectDetailFetchers` in `backend/object_detail_provider.go` or the generated
`resource_details_generated.go` / `object_detail_fetchers_generated.go`.

```go
package <kind>

import "github.com/luxury-yacht/app/backend/resources/appbinding"

// DetailBinding declares this kind's App.Get binding for the genappbindings generator.
var DetailBinding = appbinding.Spec{
    Identity: Identity,
    Service:  "<kind>.NewService(deps)",
    Import:   "github.com/luxury-yacht/app/backend/resources/<kind>",
}
```

Reference it from the kind's `Descriptor` (`Binding: &DetailBinding`), then run
`go generate ./backend` (see `backend/generate.go`) to regenerate the wrappers and
the dispatch map. The generated `objectDetailFetcherGVKs` (derived from the binding
plus `resourcecontract.BuiltinResources`) is the exact-GVK gate that keeps a custom
resource with a colliding built-in kind from being served by the wrong typed
fetcher — you no longer maintain it by hand.

Do not add per-kind raw-object fallbacks in
`backend/refresh/snapshot/object_details.go`. That snapshot builder delegates
rich detail resolution to the app-level `ObjectDetailProvider` and already
falls back to a generic details payload for unsupported or custom kinds.

### 5. Frontend TypeScript Types — MODIFY

**Files:**

- `frontend/wailsjs/go/models.ts`
- `frontend/src/modules/object-panel/components/ObjectPanel/Details/detailsTabTypes.ts`
- `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanel.tsx`
- `frontend/src/modules/object-panel/components/ObjectPanel/Details/DetailsTab.tsx`
- `frontend/src/modules/object-panel/components/ObjectPanel/Details/useOverviewData.ts`

Add the new details type to `DetailsTabProps` and thread it through:

```typescript
<kind>Details: types.<Kind>Details | null;
```

- Add the corresponding `EMPTY_DETAILS` slot and `detailPayload` switch case in
  `ObjectPanel.tsx`.
- Destructure and pass the detail object through `DetailsTab.tsx`.
- Add it to `UseOverviewDataParams` and map it into the overview shape in
  `useOverviewData.ts`.
- Add or update focused tests around the payload switch and overview mapping.

### 6. Built-In Identity Contract (When Adding A Built-In Kind) — MODIFY

**Files:** `backend/resourcecontract/builtin_resources.go`,
`backend/resourcecontract/builtin-resource-identities.json`

The kind's identity comes from its `identity.go` (Section 1). Aggregate it into
the authoritative built-in table by adding `fromIdentity(<kind>.Identity)` to
`var BuiltinResources` in `builtin_resources.go`, and add the matching row to
`builtin-resource-identities.json` (a drift test enforces that the two agree).
`backend/objectcatalog/identity.go`'s `builtinResourceCatalog` is derived from
`resourcecontract.BuiltinResources`, so it picks up the new kind automatically —
do not hand-maintain a second identity table there. Do not add custom resources
to the contract; CRDs hydrate through discovery/CRD data and carry their real
group/version.

The shared interface in `backend/resources/common/resource_identity.go` should
remain only a contract. Do not add another resolver table or kind-only fallback
there.

### 7. Built-In Frontend Identity (When Promoting a Built-In Kind) — MODIFY

**File:** `frontend/src/shared/constants/builtinGroupVersions.ts`

If this is a built-in Kubernetes kind with a first-class frontend view, add its
canonical group/version to the built-in lookup. Do not add custom resources
here; custom resources must carry group/version from catalog or API data.

### 8. Frontend Overview Component — CREATE or REUSE

**Directory:** `frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/`

If the resource is similar to an existing kind (e.g., another workload), extend the existing component with conditional rendering:

```tsx
const is<Kind> = normalizedKind.toLowerCase() === '<kind-lowercase>';

{is<Kind> && (
    <OverviewItem label="SomeField" value={someValue} />
)}
```

If the resource is substantially different, create a new `<Kind>Overview.tsx` component following the same prop pattern as `WorkloadOverview.tsx`.

### 9. Overview Registry — MODIFY

**File:** `frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/registry.ts`

Register the overview renderer for the new kind:

```typescript
overviewRegistry.register({
  kinds: ['<kind-lowercase>'],
  component: <OverviewComponent>,
  mapProps: (props) => ({ <kind>Details: props.<kind>Details || props }),
});
```

Do not rely on registry `capabilities` as the source of truth for object-panel
actions or tabs; current feature support is driven by `RESOURCE_CAPABILITIES`.

### 10. Object Panel Capabilities — MODIFY

**File:** `frontend/src/modules/object-panel/components/ObjectPanel/constants.ts`

Add or update `RESOURCE_CAPABILITIES` for supported object-panel actions and
tabs:

- `delete` for deletable resources
- `restart` only for restartable workloads
- `scale` only for scalable workloads
- `objPanelLogs`, `shell`, `debug`, `trigger`, `suspend`, or `nodeLogs` only
  when the workflow is implemented for that kind

Permission checks are evaluated from the panel object's `clusterId`,
group/version, kind, namespace, and name in
`frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelCapabilities.ts`.
If a new action kind needs different verbs, subresources, or target resources,
update that hook and the backend permission/action path together.

### 11. Refresh Table/List Surface (When Needed) — MODIFY

If the resource appears in a table/list refresh surface, update the refresh
contract together:

- Backend snapshot builder in `backend/refresh/snapshot/*.go`
- Backend registration and gates in `backend/refresh/system/registrations.go`
- Runtime permission gating via `backend/refresh/snapshot/permission.go` and the
  gate in `backend/refresh/system/permission_gate.go`
- Typed-table snapshot rows come from the kind's `Stream` descriptor facet;
  per-domain snapshot builders loop `kindregistry.StreamDescriptorsForDomain` and
  collect rows via `collectDescriptorTableRows` in
  `backend/refresh/snapshot/stream_collectors.go` (shared row helpers in
  `streaming_helpers.go`)
- Backend resource stream support: declare a `Stream *streamspec.Descriptor` on
  the kind's `Descriptor` (row DTO in `backend/kind/streamrows`); it is registered
  automatically by `registerDescriptorStreams` in
  `backend/refresh/resourcestream/stream_descriptor_dispatch.go`. Add a bespoke
  handler in `stream_registration_direct.go`/`stream_registration_network.go` only
  for related-object invalidation or a non-shared informer factory. Add resource
  stream tests when live row updates are needed
- Backend-owned refresh DTO and domain payload mapping in
  `backend/internal/genrefreshcontracts/registry.go`; run
  `go generate ./backend` and never hand-edit
  `frontend/src/core/refresh/types.generated.ts`
- Frontend resource stream descriptors in
  `frontend/src/core/refresh/streaming/resourceStreamDomains.ts` when live row
  updates are needed
- Frontend refresher names/config, orchestrator registration, manual refresh
  mapping, and diagnostics panel config under `frontend/src/core/refresh`
- GridTable consumer and shared column factories when rendering a table

Refresh domains are single-cluster only, including Resource WebSocket domains.
Do not add multi-cluster descriptor flags or send multi-cluster scopes to
snapshot, manual refresh, or stream paths; background refresh should fan out as
separate single-cluster requests.

For larger table/list work, use `.agents/skills/browse-tables/SKILL.md` and
`.agents/skills/refresh-subsystem/SKILL.md` alongside this skill.

### 12. Backend Tests — CREATE

**Files:** `backend/resources/<kind>/details_test.go` (service/DTO) and
`backend/resources/<kind>/model_test.go` (model/facts/status)

Follow the established test pattern:

```go
func TestService<Kind>(t *testing.T) {
    // 1. Create fixtures
    resource := &<apiType>{...}

    // 2. Create fake client
    client := cgofake.NewClientset(resource)

    // 3. Create deps with testsupport helpers
    deps := testsupport.NewResourceDependencies(
        testsupport.WithDepsContext(context.Background()),
        testsupport.WithDepsKubeClient(client),
    )

    // 4. Instantiate service and call method
    service := NewService(deps)
    details, err := service.<Kind>("namespace", "name")

    // 5. Assert
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
    // Assert specific fields...
}
```

Check `backend/testsupport/` for available fixture helpers and option functions.

### 13. Streaming Priority (Optional) — MODIFY

**File:** `backend/objectcatalog/service.go`

If the resource should appear quickly in the catalog, add it to `streamingResourcePriority`. Lower numbers = higher priority. Most resources don't need this — only add it if the resource is commonly viewed.

## Checklist

Before marking done:

- [ ] Required surfaces were chosen from the resource surface matrix
- [ ] Per-kind package created with `identity.go` + `descriptor.go` and registered with one entry in `backend/kind/kindregistry`
- [ ] Per-kind model/facts/status added (built on shared `resourcemodel` primitives) or explicitly deemed unnecessary
- [ ] Backend `Service` (`NewService`) fetches the resource and related resources
- [ ] `<Kind>Details` DTO defined in `backend/resources/<kind>/dto.go` with display-ready fields
- [ ] Primary status comes from the kind's model and projects `statusPresentation`
- [ ] Relationship links use `resourcemodel.ResourceLink` constructors and are validated
- [ ] `appbinding.Spec` declared (`Binding` on the descriptor) and `go generate ./backend` re-run (generated detail dispatch + exact-GVK gate)
- [ ] Wails bindings/type definitions reflect backend DTO changes
- [ ] Frontend detail payload is wired through `ObjectPanel.tsx`, `DetailsTabProps`, `DetailsTab.tsx`, and `useOverviewData.ts`
- [ ] For built-ins: identity added to `resourcecontract.BuiltinResources` and `builtin-resource-identities.json`
- [ ] Frontend built-in GVK lookup updated if a built-in kind was promoted to
      first-class frontend support
- [ ] Overview component renders resource-specific fields
- [ ] Overview registry maps the kind to the component
- [ ] `RESOURCE_CAPABILITIES` reflects supported object-panel actions/tabs
- [ ] Refresh domains, stream rows, diagnostics, and GridTable consumers are wired if the resource appears in list/table surfaces
- [ ] Object-map support is updated only if backend graph data and frontend support lists both need the kind
- [ ] Tests cover the happy path and at least one error case
- [ ] `mage qc:prerelease` passes

## Validation Recipe

Use focused checks while iterating:

```sh
go generate ./backend   # regenerate detail bindings after adding/changing a kind
go test ./backend ./backend/resources/... ./backend/resourcemodel ./backend/kind/... ./backend/refresh/snapshot
npm run typecheck --prefix frontend
npm run test --prefix frontend -- <relevant spec or module>
```

Then run the final gate for non-documentation work:

```sh
mage qc:prerelease
git diff --check
git status --short
```

Because `mage qc:prerelease` runs frontend lint-fix, inspect the worktree after
it completes.
