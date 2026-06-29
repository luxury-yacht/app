# Resource stream signals

Resource-stream table, event, and catalog domains are query-backed. The HTTP
snapshot/query path owns rows, filtering, sorting, facets, totals, and payload
metadata. The resource WebSocket is only the liveness channel that tells a
query-backed view when to refetch.

## Invariants

- `streammux.ServerMessage` must not grow a projected row field. The message may
  carry `Ref`, `Source`, `Version`, `Signal`, `Sequence`, `ResourceVersion`,
  cluster routing metadata, and errors.
- Signal envelopes carry refetch identity only: `clusterId`, `domain`, `scope`,
  `source`, `version`, and `signal`. The frame must not carry rows, positions,
  query params, sort/filter state, page limits, cursors, or `continue` tokens.
- `version` is an opaque source-token string. Consumers compare it for equality
  only; they must not parse or order it.
- `Manager.newObjectRowUpdate` may accept a row argument for projector guardrails
  and scope resolution, but it must emit only the signal fields.
- `ResourceStreamManager.flushUpdates` must coalesce update messages and advance
  the scoped domain's `sourceVersion` / `sourceVersions`; it must not retain,
  merge, or sort streamed rows.
- Query-backed table hooks must use the scoped domain `sourceVersion` as the
  live-data identity so a signal changes the query identity and refetches the
  visible page. `streamRevision` is retained only as diagnostic/backward-
  compatible state and must not drive query identity.
- `Sequence` is transport resume/high-water metadata only. Per-object Kubernetes
  `resourceVersion` is reflector metadata only. Snapshot `Sequence` is internal
  build/debug metadata only.
- Metric-only changes may advance the `metric` source clock and refetch
  metric-backed visible pages, but they must not advance the object source
  version.

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
- `sourceClocks` names the producer clocks that can affect a domain:
  `object`, `metric`, `catalog`, or `event`.
- `complete-resync-stream` domains, such as Helm, keep
  `coverageContract: "complete-resync-only"` because the stream sends
  scope-level resync signals rather than object-change signals.

## Source Clocks

- `object` changes object-backed row membership, fields, sort keys, filters, or
  facts.
- `metric` changes metric-backed values, metric freshness metadata, or
  metric-backed sort keys. Object-sorted metric-bearing pages keep their base
  object query result and overlay metric-domain rows for the visible row
  identities. Metric-sorted pages query the metric domain for membership,
  ordering, totals, cursor metadata, and metric values, then hydrate base object
  rows by the returned identities.
- `catalog` changes catalog-backed identity or Browse results.
- `event` changes event-backed query results.

Metric-dependent visible pages should throttle automatic refetches using the
metrics refresh interval. Object-sorted metric pages should keep the same object
row identity/order/object-only fields while allowing metric cells and metric
metadata to change. Metric-sorted pages should resume through the existing
keyset cursor rather than resetting to page 1.

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
