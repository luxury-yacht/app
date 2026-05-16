---
name: browse-tables
description: Work on cluster/namespace views, browse/catalog surfaces, shared GridTable behavior, large datasets, filters, and refresh-backed table tests
---

# Browse And Tables

Use this when touching cluster or namespace resource views, Browse/catalog UI,
shared `GridTable`, table columns, filters, pagination/load-more, row identity,
large-data behavior, or refresh-backed list/table tests.

## Core Contracts

Read:

1. `AGENTS.md`
2. `backend/AGENTS.md` for snapshot/catalog changes
3. `frontend/AGENTS.md` for table/view changes
4. `docs/architecture/catalog.md`
5. `docs/architecture/refresh-system.md`
6. `docs/architecture/data-access.md`
7. `docs/frontend/gridtable.md`
8. `docs/architecture/large-data.md`

## Backend Entry Points

- `backend/objectcatalog`
- `backend/refresh/snapshot/catalog.go`
- `backend/refresh/snapshot/*.go`
- `backend/refresh/system/registrations.go`
- `backend/refresh/resourcestream`

The object catalog owns discovery, existence, namespace listings, cluster
listings, and canonical identity. Typed refresh snapshots may add richer row
data, but they must preserve catalog-shaped identity.

## Frontend Entry Points

- `frontend/src/modules/browse`
- `frontend/src/modules/cluster`
- `frontend/src/modules/namespace`
- `frontend/src/core/data-access`
- `frontend/src/core/refresh`
- `frontend/src/core/refresh/streaming/resourceStreamDomains.ts`
- `frontend/src/shared/components/tables`

Use `GridTable` and shared column factories. Frontend reads should flow through
`dataAccess` or the refresh orchestrator, not direct `fetch` calls.

## Checklist

- [ ] Rows carry complete cluster/GVK/object identity.
- [ ] Refresh domain, payload type, refresher config, orchestrator, diagnostics,
      and backend registration stay synchronized.
- [ ] Snapshot and resource-stream row shapes match for streamed domains.
- [ ] Streamed table domains update resource stream descriptors, backend
      supported domains, registration files, and single-cluster stream tests.
- [ ] Catalog-backed browse behavior remains the identity/existence source of
      truth.
- [ ] Large datasets retain pagination/load-more, truncation diagnostics, and
      table performance behavior.
- [ ] Table changes reuse `GridTable` and shared column factories.
- [ ] Tests cover the changed refresh, catalog, table, or large-data behavior.
- [ ] Non-doc changes pass `mage qc:prerelease`.

## Validation

Use focused checks while iterating:

```sh
go test ./backend/objectcatalog ./backend/refresh/snapshot ./backend/refresh/system
npm run typecheck --prefix frontend
npm run test --prefix frontend -- browse tables cluster namespace
```

For broad shared-table changes, also run `mage qc:knip`, then
`mage qc:prerelease` for non-documentation changes.
