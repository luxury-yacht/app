---
name: shared-resource-model
description: Work on Luxury Yacht canonical Kubernetes resource identity, status presentation, facts, ResourceLink relationships, DTO projection, table/detail/object-map parity, and shared resource model tests
---

# Shared Resource Model

Use this when touching canonical object identity, resource status,
`statusPresentation`, lifecycle, facts, owner/relationship links,
`ResourceLink`, event involved-object identity, DTO projection, or parity across
refresh rows, streams, object panel details, and object map nodes/edges.

## Task routes

Read only the contracts selected by the change. Follow further links when the
changed path crosses that boundary.

| Change | Read |
| --- | --- |
| Object references or GVK identity | [shared-resource-model](../../../docs/architecture/shared-resource-model.md#identity), including Frontend Reference Types |
| Status, lifecycle, facts, segments or relationship projections | [shared-resource-model](../../../docs/architecture/shared-resource-model.md); select Agent Contract, Status, Links, or Use The Model For |
| Per-kind package, descriptor or registry layout | [resource-kind-registry](../../../docs/architecture/resource-kind-registry.md) |
| Discovery, existence or GVK/GVR resolution | [catalog](../../../docs/architecture/catalog.md) |
| Refresh payload, scope or stream consumers | [refresh-system](../../../docs/architecture/refresh-system.md) |
| Adding a kind or a kind's surface | [add-resource skill](../add-resource/SKILL.md) |

## Entry Points

- Backend: `backend/resources/<kind>` (`identity.go`, `descriptor.go`,
  `model.go`, `facts.go`, `dto.go`); `backend/resourcemodel`;
  `backend/resourcekind`, `backend/resourcecontract`,
  `backend/kind/kindregistry`; `backend/refresh/snapshot`;
  `backend/resource_gateway.go` (request-shaped detail/action owner);
  `backend/resources/types`; `backend/object_detail_provider.go` (generated
  detail dispatch).
- Frontend: `frontend/src/shared/utils/backendStatusPresentation.ts`,
  `frontend/src/shared/utils/resourceLinkIdentity.ts`,
  `frontend/src/shared/utils/objectIdentity.ts`,
  `frontend/src/modules/object-panel`, `frontend/src/modules/object-map`, and
  refresh/table consumers under `frontend/src/modules/*` and
  `frontend/src/core/refresh/types.ts`.

## Validation

Focused checks while iterating:

```sh
mise exec -- go test ./backend/resourcemodel ./backend/refresh/snapshot ./backend/resources/... ./backend
mise exec -- npm run typecheck --prefix frontend
mise exec -- npm run test --prefix frontend -- backendStatusPresentation resourceLinkIdentity object-map object-panel
```
