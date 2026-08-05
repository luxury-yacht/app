---
name: add-resource
description: Add or extend support for a Kubernetes resource kind across the required catalog, refresh, detail, object-panel, object-map, permission, documentation, and test surfaces
---

# Add Resource

Treat resource support as a set of selectable surfaces, not one monolithic
workflow. Decide the user-visible contract before editing.

## Select surfaces

| Surface | Owner |
| --- | --- |
| Identity, status, facts, relationships | per-kind package plus `backend/resourcemodel` |
| Discovery and Browse | object catalog and catalog snapshot |
| List/table rows and streams | `backend/refresh/snapshot`, refresh system, frontend refresh |
| Rich detail and operations | `backend/resources/<kind>`, generated app binding |
| Object-panel rendering/actions | Overview descriptors, panel capabilities, action backends |
| Object map | per-kind graph facet, map snapshot, frontend support |
| YAML/apply and permissions | object YAML paths, RBAC/capability contracts |

List/table payloads belong in refresh snapshots; rich details and imperative
operations belong in `backend/resources`. The catalog owns discovery and
identity metadata; the `namespaces` refresh domain owns namespace LIST rows.

## Workflow

1. Identify group, version, kind, plural resource, and scope.
2. Inspect one comparable per-kind package; use
   `backend/resources/deployment` for a first-class workload example.
3. Write the surface list and related-object relationships before code changes.
4. Read only the references matching those surfaces:
   - [kind and details](references/kind-and-details.md) for identity, descriptor, model, DTO,
     service, generated detail bindings, or built-in identity;
   - [frontend surfaces](references/frontend-surfaces.md) for Overview rendering, derived detail
     sections, built-in frontend identity, panel actions, or YAML UI;
   - [refresh and tests](references/refresh-and-tests.md) for catalog, table/list snapshots,
     resource streams, diagnostics, object-map participation, and the validation
     matrix.
5. If status, facts, links, or object references change, read
   `docs/architecture/shared-resource-model.md`. If refresh behavior changes,
   read the refresh-subsystem skill and only its matching references. If graph
   behavior changes, use the object-map skill.
6. Trace every producer and consumer for the chosen surfaces, then work in
   red/green/refactor cycles.

## Invariants

- Define a first-class kind once in its package and register its descriptor once
  in `backend/kind/kindregistry/registry.go`; subsystems select descriptor
  facets instead of maintaining kind lists.
- Project shared status, facts, and relationships from the per-kind model into
  DTO, snapshot, stream, and map consumers.
- Generate app detail bindings; never hand-edit generated dispatch or its
  derived exact-GVK gate.
- Keep snapshot and resource-stream row shapes at parity.
- Custom resources retain discovered group/version; do not place them in
  built-in identity tables.
- Explain any intentionally omitted user-visible surface before narrowing the
  requested support.

## Validation

Run only checks for changed surfaces while iterating, then follow the root final
gate:

```sh
mise exec -- go generate ./backend
mise exec -- go test ./backend/resources/... ./backend/resourcemodel ./backend/kind/...
mise exec -- go test ./backend/objectcatalog ./backend/refresh/snapshot ./backend/refresh/system
mise exec -- npm run typecheck --prefix frontend
mise exec -- npm run test --prefix frontend -- <affected module or spec>
```

Inspect generated files and the worktree after generation or formatting.
