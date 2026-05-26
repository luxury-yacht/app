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
| Rich object details/actions        | `backend/resources`, `backend/object_detail_provider.go`, `backend/resources/types` | Object-panel details/overview registry                       | Use for detail tabs, logs/debug helpers, and imperative operations.                          |
| Shared identity/status/links/facts | `backend/resourcemodel`                                                             | status/link rendering utilities                              | Backend owns primary status and relationship semantics.                                      |
| YAML/edit/apply                    | object YAML/read/apply backend paths                                                | object-panel YAML tab                                        | Must carry clusterId and full GVK identity.                                                  |
| Object map                         | `.agents/skills/object-map/SKILL.md`, `backend/refresh/snapshot/object_map.go`      | `frontend/src/modules/object-map`, object-panel support list | Fix backend graph data before frontend renderer/allowlist changes.                           |
| Permissions/capabilities           | refresh permission checks, capability backends                                      | RBAC-gated UI/action surfaces                                | Keep permission-denied diagnostics visible.                                                  |
| Docs/tests                         | owning architecture/workflow docs                                                   | adjacent specs/stories when useful                           | Update durable docs when contracts or supported kinds change.                                |

If the requested task only needs one surface, keep the implementation scoped to
that surface. If user-visible support would be incomplete without another
surface, explain the tradeoff before narrowing.

## Arguments

`/add-resource <Kind>` — e.g., `/add-resource CronJob`, `/add-resource Ingress`

## Before Starting

1. **Identify the resource's API group and package.** For rich object details/actions, look at existing resources in `backend/resources/` to find the right category directory (workloads, network, storage, config, policy, etc.). If none fits, create a new one. For table/list data, use `backend/refresh/snapshot` instead.
2. **Read the existing pattern.** Read at least one complete example in the same category — e.g., `backend/resources/workloads/deployments.go` for workloads, `backend/resources/network/` for networking resources.
3. **Identify related resources.** Deployments relate to ReplicaSets and Pods. What does the new resource relate to? This determines what data the detail view should aggregate.
4. **Follow the shared resource model contracts.** Read `docs/architecture/shared-resource-model.md` before adding status, relationship links, capability checks, or object references. The backend owns status semantics; frontend status classes come from `statusPresentation`; relationship links use `resourcemodel.ResourceLink`; object references must carry `clusterId`, `group`, `version`, `kind`, and concrete object names.
   Do not guess `resource` from `kind`, and do not treat an empty Kubernetes
   `apiVersion` as core `v1`.
5. **Check refresh and frontend data contracts** if the resource appears in a
   table, stream, diagnostics panel, or object map. Read
   `docs/architecture/refresh-system.md`, `docs/architecture/data-access.md`,
   and `.agents/context/code-map.md`.

## Files to Create or Modify

### 1. Shared Resource Model — CREATE or MODIFY

**Directory:** `backend/resourcemodel`

If the resource has primary status, lifecycle, durable facts, relationships, or
links, add or update the shared model before adding DTO projection code:

- Add a `Build<Kind>ResourceModel` function and typed fact fields when the
  resource has durable Kubernetes semantics.
- Populate canonical identity with `clusterId`, `group`, `version`, `kind`,
  `resource`, scope, namespace, and name.
- Represent relationships with `ResourceLink`; use display-only refs only when
  the source does not provide enough identity for safe navigation.
- Add adjacent `resourcemodel` tests for status, facts, refs, and relationship
  behavior.
- Project from the model into detail DTOs, refresh rows, object-map nodes, or
  event/link payloads instead of reimplementing status or relationships in each
  consumer.

Do not add empty fact slots just to reserve future space. Add shared facts only
when a migrated consumer actually reads them.

### 2. Backend Service — CREATE or MODIFY

**File:** `backend/resources/<category>/<resource>.go`

Follow this pattern:

```go
package <category>

import (
    "github.com/luxury-yacht/app/backend/resources/common"
    restypes "github.com/luxury-yacht/app/backend/resources/types"
    // k8s API imports for the resource
)

type <Kind>Service struct {
    deps common.Dependencies
}

func New<Kind>Service(deps common.Dependencies) *<Kind>Service {
    return &<Kind>Service{deps: deps}
}

// <Kind> returns the detailed view for a single resource.
func (s *<Kind>Service) <Kind>(namespace, name string) (*restypes.<Kind>Details, error) {
    client := s.deps.KubernetesClient
    if client == nil {
        return nil, fmt.Errorf("kubernetes client not initialized")
    }
    item, err := client.<APIGroup>().<Resources>(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
    if err != nil {
        return nil, fmt.Errorf("failed to get <kind>: %w", err)
    }
    model := resourcemodel.Build<Kind>ResourceModel(s.deps.ClusterID, item)
    // Fetch related resources, project shared model facts/status into the DTO,
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
  keep semantic status, refs, and durable facts in `backend/resourcemodel`

### 3. Type Definition — MODIFY

**File:** `backend/resources/types/types.go`

Add a `<Kind>Details` struct. Include:

- Basic metadata: Kind, Name, Namespace, Age, Labels, Annotations
- Shared status projection fields when the resource has meaningful primary status:
  `Status`, `StatusState`, `StatusPresentation`, and optionally `StatusReason`
- Resource-specific fields from the Kubernetes spec/status
- Related resource summaries (pods, events, etc.)
- Computed display strings at the final DTO boundary only (e.g., "Ready: 2/3")

Look at neighboring types in the same file for field naming conventions — they use plain strings for display values, not raw Kubernetes types.

If Go DTOs change, refresh or verify the Wails bindings in
`frontend/wailsjs/go/models.ts`. `wails generate` may not work in every local
run, so validate bindings with frontend typecheck.

### 4. Detail Provider Dispatch — MODIFY

**File:** `backend/object_detail_provider.go`

Add an entry to the `objectDetailFetchers` map:

```go
"<kind-lowercase>": {
    withDeps: func(deps common.Dependencies, namespace, name string) (interface{}, string, error) {
        detail, err := <category>.New<Kind>Service(deps).<Kind>(namespace, name)
        return detail, "", err
    },
},
```

The key must be lowercase (e.g., `"cronjob"`, `"ingress"`). The `lookupObjectDetailFetcher` function normalizes input to lowercase.

Also add the exact GVK to `objectDetailFetcherGVKs`. That map is typed-fetcher
capability metadata, not resource identity. It prevents a custom resource with a
colliding built-in kind from being served by the wrong typed fetcher.

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

### 6. Backend Catalog Identity (When Adding A Built-In Kind) — MODIFY

**File:** `backend/objectcatalog/identity.go`

If this is a built-in Kubernetes kind that must resolve before the first catalog
sync, add its canonical group/version/resource/scope to `builtinResourceCatalog`.
Do not add custom resources here; CRDs must hydrate through discovery/CRD data
and carry their real group/version.

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
- Runtime permission checks in `backend/refresh/snapshot/permission_checks.go`
- Shared row helpers/tests in `backend/refresh/snapshot/streaming_helpers.go`
  when a resource stream emits matching rows
- Backend resource stream support in
  `backend/refresh/resourcestream/stream_registration_*.go`,
  `backend/refresh/resourcestream/domains.go`, and resource stream tests when
  live row updates are needed
- Frontend `RefreshDomain` and `DomainPayloadMap` in
  `frontend/src/core/refresh/types.ts`
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

**File:** `backend/resources/<category>/<resource>_test.go`

Follow the established test pattern:

```go
func Test<Kind>Service<Kind>(t *testing.T) {
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
    service := <category>.New<Kind>Service(deps)
    details, err := service.<Kind>("namespace", "name")

    // 5. Assert
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
    // Assert specific fields...
}
```

Check `backend/test/testsupport/` for available fixture helpers and option functions.

### 13. Streaming Priority (Optional) — MODIFY

**File:** `backend/objectcatalog/service.go`

If the resource should appear quickly in the catalog, add it to `streamingResourcePriority`. Lower numbers = higher priority. Most resources don't need this — only add it if the resource is commonly viewed.

## Checklist

Before marking done:

- [ ] Required surfaces were chosen from the resource surface matrix
- [ ] Shared resource model facts/status/links were added or explicitly deemed unnecessary
- [ ] Backend service fetches the resource and related resources
- [ ] Detail struct defined in `types.go` with display-ready fields
- [ ] Primary status comes from the shared resource model and projects `statusPresentation`
- [ ] Relationship links use `resourcemodel.ResourceLink` constructors and are validated
- [ ] Detail provider dispatches to the new service and has exact-GVK
      `objectDetailFetcherGVKs` metadata
- [ ] Wails bindings/type definitions reflect backend DTO changes
- [ ] Frontend detail payload is wired through `ObjectPanel.tsx`, `DetailsTabProps`, `DetailsTab.tsx`, and `useOverviewData.ts`
- [ ] Backend catalog built-in identity seed updated if the built-in must
      resolve before catalog sync
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
go test ./backend ./backend/resources/... ./backend/resourcemodel ./backend/refresh/snapshot
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
