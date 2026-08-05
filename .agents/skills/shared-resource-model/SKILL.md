---
name: shared-resource-model
description: Work on Luxury Yacht canonical Kubernetes resource identity, status presentation, facts, ResourceLink relationships, DTO projection, table/detail/object-map parity, and shared resource model tests
---

# Shared Resource Model

Use this when touching canonical object identity, resource status,
`statusPresentation`, lifecycle, facts, owner/relationship links,
`ResourceLink`, event involved-object identity, DTO projection, or parity across
refresh rows, streams, object panel details, and object map nodes/edges.

## Read First

1. `AGENTS.md`
2. `backend/AGENTS.md`
3. `frontend/AGENTS.md` for frontend consumers
4. `docs/architecture/shared-resource-model.md`
5. `docs/architecture/resource-kind-registry.md` for the per-kind package +
   registry layout (where identity, model, facts, and DTO live)
6. `docs/architecture/catalog.md` when identity/existence is involved
7. `docs/architecture/refresh-system.md` when rows, streams, events, or object
   details consume the model

## Backend Entry Points

- `backend/resources/<kind>` — per-kind `identity.go`, `descriptor.go`,
  `model.go`, `facts.go`, `dto.go` (the single definition of a kind)
- `backend/resourcemodel` — shared status/facts/link primitives + relationship
  index that the per-kind models build on
- `backend/resourcekind`, `backend/resourcecontract`, `backend/kind/kindregistry`
  — identity leaf, the built-in identity contract, and the kind registry
- `backend/refresh/snapshot`
- `backend/resources/types` — shared cross-kind DTO field types
- `backend/object_detail_provider.go` — detail dispatch (generated bindings)

## Frontend Entry Points

- `frontend/src/shared/utils/backendStatusPresentation.ts`
- `frontend/src/shared/utils/resourceLinkIdentity.ts`
- `frontend/src/modules/object-panel`
- `frontend/src/modules/object-map`
- Refresh/table consumers under `frontend/src/modules/*` and
  `frontend/src/core/refresh/types.ts`

## Checklist

- [ ] Object refs crossing boundaries include `clusterId`, group, version, kind,
      and namespace/name for concrete objects.
- [ ] Backend GVK/GVR/scope lookups use the object catalog `ResourceResolver`.
      Built-ins use their real group/version from the catalog seed; CRDs
      preserve group/version from discovery, catalog, owner refs, HPA targets,
      events, or manifests.
- [ ] Primary status is computed once in backend model code and projected as
      `status`, `statusState`, `statusPresentation`, and optional
      `statusReason`.
- [ ] Frontend renders backend presentation fields instead of deriving primary
      status classes.
- [ ] Relationships use `ResourceLink`; incomplete source refs become
      display-only refs rather than unsafe navigation links.
- [ ] Facts stay semantic until the final DTO/table formatting boundary.
- [ ] Table rows, stream rows, object panel details, events, and object-map
      payloads stay consistent when they render the same resource family.
- [ ] Tests cover model status/facts/links and every changed projection.

## Validation

Use focused checks while iterating:

```sh
mise exec -- go test ./backend/resourcemodel ./backend/refresh/snapshot ./backend/resources/... ./backend
mise exec -- npm run typecheck --prefix frontend
mise exec -- npm run test --prefix frontend -- backendStatusPresentation resourceLinkIdentity object-map object-panel
```

Then follow the root final validation gate.
