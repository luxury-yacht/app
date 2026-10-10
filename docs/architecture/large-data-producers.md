# Large Data Producer Reference

Per-family producer and consumer facts; search for the affected family. Shared
rules: [large data](large-data.md); query mechanics, including single-namespace
`baseScope` paging: [query contract](large-data-query.md).

- Config, RBAC, storage, network, quotas, autoscaling, and Helm expose typed
  backend query pages for cluster, all-namespaces, and single-namespace
  surfaces.
- Status, Owner, and Node are provider-owned query facets, not fixed
  typed-query fields; Pods, Workloads, and Nodes publish them as capability
  descriptors ([query facets](../frontend/gridtable-filtering.md#query-facets)).
  Their options describe the full structural scope, not the current page or the
  active selection.

## Pods

`backend/refresh/snapshot/pods.go` feeds namespace and all-namespaces pod tables
(identity, status, restarts, readiness, node, owner, metrics projection).
All-namespaces Pods are `Query Backed Dynamic`: search, namespace/status/node
filters, health predicates, pagination, and CPU/memory sort are backend-owned
for the current metrics snapshot. Rows serve from a maintained `querypage` store
fed by owned-reflector ingest ([data-layer.md](data-layer.md)). One frontend
`PodsTable` (`NsViewPods.tsx`) serves the namespace Pods view, with the full
filter set, and the Pods table attached under a Workloads or Nodes row.

## Workloads

`backend/refresh/snapshot/namespace_workloads.go` feeds single-namespace and
all-namespaces `Query Backed Dynamic` tables: kind, namespace, and status
filters, search, pagination, and CPU/memory aggregate sorts are backend-owned.
Status options stay available when a Status selection or fixed health predicate
narrows results. Rows serve from a maintained `querypage` store fed by the
workload GVRs' reflectors; pod aggregates, HPA, and metrics join at serve.

The namespace Workloads and cluster Nodes destinations are one query-backed
table each. A row's Pods count or `Space` opens that row's pods in a Pods table
attached under it ([row detail](../frontend/gridtable-interaction.md#row-detail));
a row click only highlights. The attached table is its own query-backed table
with its own filter, sort, cursor, page size, and diagnostics, but its table
state lives in memory only and is never in favorites:

- Opening a row narrows the attached Pods table through a request-only
  selection facet: the provider-owned Owner facet for a workload, whose values
  carry full object identity, or the Node facet for a node. Deployments resolve
  through ReplicaSets, CronJobs through Jobs, direct owners match directly, and
  an ownerless Pod uses its own core/v1 identity. Projected Pod rows keep both
  direct-controller and resolved-ancestor identities; no generated-name parsing.
- The attached table shows no Namespaces, Owner, or Node control, and no Owner
  column under a workload or Node column under a node; changing cluster or
  pinned namespace, or the open row leaving the table, closes it.
- A workload's pods use the namespace scope; a node's pods use `namespace:all`,
  which streams while the Nodes view is active.

## Nodes

`backend/refresh/snapshot/nodes.go` feeds a `Query Backed Dynamic` cluster
table: search, pagination, status filters, age sort, and CPU/memory sorts are
backend-owned for the current resource and metric projection.

## Custom resources

- Cluster and namespace custom tables take their row universe from the catalog
  query with `customOnly=true`; the catalog contract owns search, kind filters,
  sort, paging, counts, and facets.
- The frontend hydrates only the current page through `HydrateCatalogCustomRows`
  (status, readiness, conditions, labels, annotations). CSV export hydrates all
  matching rows through the same live API path; catalog membership is not a rich
  detail payload.
- The full-list Custom domains are retired and not registered or accepted by
  resource streams. `cluster-custom` and `namespace-custom` remain
  table-persistence and navigation IDs so saved settings survive.
- CRD changes trigger the shared full resync; partial recollection is not
  justified yet ([measurement](large-data-measurements.md#catalog-full-resync)).

## Events

Cluster and namespace event tables are `Query Backed Static` typed query pages
over the current event set. Object-panel events are object-scoped recent/capped
windows, visibly `Local Partial`.

- Both tables share `projectEventRow` (`backend/refresh/snapshot/event_rows.go`).
  Type, source, message, and object carry the Event's own values, empty when
  absent, rendered with the shared empty placeholder; a blank message never
  repeats the reason. The Event detail status uses the shared vocabulary
  (`Unknown` for an untyped Event). Object Type and Object Name come from the
  involved object, not display text.
- Every Events surface judges recency and orders by the latest observation
  (`EventTimestamp` in `backend/resources/events`), covering `events.k8s.io`
  series that keep `eventTime` at their first occurrence.
- The object-panel window keeps the most recently observed events when it
  truncates and matches the involved object by API group, not version.
- Every Events surface opens an involved object only from the backend's
  `involvedObject` link, never guessing group or version from the kind. Without
  an openable link, the Events tables, Events tab, and Recent Events fall back
  to a catalog lookup by UID; the Event detail panel shows it as text.
- Reconcile reports rows swept after a spill restore through the same doorbell
  as informer deletes, so rows for Events that expired while the cluster was
  Cold leave the tables.
