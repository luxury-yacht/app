# Resource stream signals

Resource-stream table, event, and catalog domains are query-backed. The HTTP
snapshot/query path owns rows, filtering, sorting, facets, totals, and payload
metadata. The resource WebSocket is only the liveness channel that tells a
query-backed view when to refetch.

## Invariants

- `streammux.ServerMessage` must not grow a projected row field. The message may
  carry `Ref`, `Source`, `Version`, `Signal`, `Sequence`, `ResourceVersion`,
  cluster routing metadata, and errors.
- `Manager.newObjectRowUpdate` may accept a row argument for projector guardrails
  and scope resolution, but it must emit only the signal fields.
- `ResourceStreamManager.flushUpdates` must coalesce update messages and advance
  the scoped domain's `sourceVersion` / `sourceVersions`; it must not retain,
  merge, or sort streamed rows.
- Query-backed table hooks must use the scoped domain `sourceVersion` as the
  live-data identity so a signal changes the query identity and refetches the
  visible page. `streamRevision` is retained only as diagnostic/backward-
  compatible state and must not drive query identity.

## Contract Vocabulary

`backend/refresh/domain/refresh-domain-contract.json` is the shared source of
truth.

- `resource-stream-table` domains use `streamSemantics:
  ["snapshot-replace", "change-signal", "complete-resync"]`.
- Their `coverageContract` is `query-refetch-on-signal`.
- `resourceStream.updateIdentity.changeSignals` and `.deleteSignals` are both
  `ref`; the object identity lives in `resourcemodel.ResourceRef`.
- Event and catalog domains use `sourceClocks` plus `change-signal` semantics
  on the same resource WebSocket, but their rows are still fetched from their
  snapshot/query domains.
- `complete-resync-stream` domains, such as Helm, keep
  `coverageContract: "complete-resync-only"` because the stream sends
  scope-level resync signals rather than object-change signals.

## Starting Points

- Backend envelope: `backend/refresh/streammux/types.go`
- Backend signal helper: `backend/refresh/resourcestream/update_helpers.go`
- Frontend signal application: `frontend/src/core/refresh/streaming/resourceStreamManager.ts`
- Query refetch trigger: `frontend/src/modules/resource-grid/useQueryBackedResourceGridTable.ts`
- Contract enforcement:
  - `backend/refresh/system/registrations_test.go`
  - `frontend/src/core/refresh/domainContract.test.ts`

## Validation

Run the backend and frontend contract tests after changing stream semantics:

```sh
go test ./backend/refresh/system -run 'TestDomainInventory|TestResourceStreamIdentityContract'
npm run test --prefix frontend -- --run src/core/refresh/domainContract.test.ts
```

Before presenting non-doc-only work as complete, run `mage qc:prerelease`.
