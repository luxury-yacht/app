---
name: add-resource
description: Add or extend support for a Kubernetes resource kind across the required catalog, refresh, detail, object-panel, object-map, permission, documentation, and test surfaces
---

# Add Resource

Treat resource support as a set of selectable surfaces, not one monolithic
workflow. Decide the user-visible contract before editing.

## Select surfaces

| Surface | Owner | Steps |
| --- | --- | --- |
| Identity, status, facts, relationships | per-kind package plus `backend/resourcemodel` | [kind and details](references/kind-and-details.md) |
| Rich detail and operations | `backend/resources/<kind>`, generated app binding | [kind and details](references/kind-and-details.md) |
| Discovery and Browse | object catalog and catalog snapshot | [refresh and tests](references/refresh-and-tests.md) |
| List/table rows and streams | `backend/refresh/snapshot`, refresh system, frontend refresh | [refresh and tests](references/refresh-and-tests.md) |
| Object map | per-kind graph facet, map snapshot, frontend support | [refresh and tests](references/refresh-and-tests.md) |
| Object-panel rendering/actions | Overview descriptors, panel capabilities, action backends | [frontend surfaces](references/frontend-surfaces.md) |
| YAML/apply and permissions | object YAML paths, RBAC/capability contracts | [frontend surfaces](references/frontend-surfaces.md) |

## Workflow

1. Identify group, version, kind, plural resource, and scope.
2. Inspect one comparable per-kind package; `backend/resources/deployment` is
   the first-class workload example.
3. Write the surface list and related-object relationships before code changes.
   Explain any intentionally omitted user-visible surface before narrowing the
   requested support.
4. Read only the references for the selected surfaces (table above).
5. Contracts: [resource-kind-registry](../../../docs/architecture/resource-kind-registry.md)
   for per-kind definition and dispatch;
   [shared-resource-model](../../../docs/architecture/shared-resource-model.md)
   when status, facts, links, or object references change; the
   refresh-subsystem skill (matching references only) when refresh behavior
   changes; the object-map skill when graph behavior changes.
6. Trace every producer and consumer for the chosen surfaces before editing.

## Validation

Run only checks for changed surfaces while iterating:

```sh
mise exec -- go generate ./backend
mise exec -- go test ./backend/resources/... ./backend/resourcemodel ./backend/kind/...
mise exec -- go test ./backend/objectcatalog ./backend/refresh/snapshot ./backend/refresh/system
mise exec -- npm run typecheck --prefix frontend
mise exec -- npm run test --prefix frontend -- <affected module or spec>
```

Inspect generated files and the worktree after generation or formatting.
