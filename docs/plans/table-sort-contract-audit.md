# Table Sort Contract Audit

## Purpose

Refresh-backed table sorting regressed because visible column keys, persisted
sort keys, and backend query sort keys were not enforced as one contract.

This audit records the production query-backed table surfaces covered by the
rendered contract test in
`frontend/src/modules/resource-grid/queryBackedLeafFirstLoad.test.tsx`.

## Contract

- Query-backed tables publish only sortable column keys that the query backend
  supports for that table mode.
- `GridTable` treats a column as sortable unless it is explicitly marked
  `sortable: false`; header clicks, header/cell context menus, width
  measurement, and persistence pruning must all use that same rule.
- Default query sort keys must be visible `GridTable` column keys.
- Hidden data fields such as `ageTimestamp` may be used as sort values, but
  must not be published as table sort keys.
- Persisted sort keys that no longer map to a current sortable column are
  pruned by table persistence.
- Query-backed tables must publish sort changes through their controlled sort
  callback even when the hydrated persisted sort value starts as `null`.
- Hydrated post-page fields on catalog-backed custom-resource tables are not
  advertised as globally sortable query fields.
- Durable GridTable sorting guidance is recorded in
  `docs/frontend/gridtable.md`.

## Covered Query-Backed Typed Tables

- Cluster: config, storage, RBAC, CRDs, events, nodes.
- Namespace/all-namespaces: config, network, storage, autoscaling, quotas,
  RBAC, Helm, events, pods, workloads.
- Frontend coverage renders the real production components and asserts the
  sortable `GridTable` column keys they publish.
- Backend coverage asserts representative alias, relationship, timestamp, and
  metric sort keys in `backend/refresh/snapshot/static_table_query_test.go`,
  including events object columns, autoscaling scale target/replicas, Helm
  updated, pod owner/node/ready/cpu/memory, workload ready/cpu/memory, CRD
  version, storage access modes, and age timestamp sorting.

## Covered Local/Catalog Exceptions

- Browse catalog tables assert cluster and all-namespaces sortable keys against
  the catalog-backed key set: kind, name, namespace when shown, and age.
- Cluster and namespace custom-resource CRD/status columns are explicitly
  non-sortable because catalog-backed queries page by catalog identity before
  those fields are hydrated.
- Object-panel events default to the visible `age` column and use
  `ageTimestamp` only through the column sort value.
- Object-panel pods and jobs assert their local sortable column key sets; pod
  owner sorting is covered through the displayed owner sort value.
- Parsed/log-derived tables are excluded from resource sort contracts because
  their log columns are explicitly non-sortable.

## Validation Status

- ✅ `npm test --prefix frontend -- useGridTableHeaderRow useGridTableHeaderContextMenu gridTablePersistence useGridTableColumnMeasurer useTableSort GridTable`
- ✅ `npm test --prefix frontend -- queryBackedLeafFirstLoad useQueryBackedResourceGridTable useResourceGridTable BrowseView ClusterViewCustom NsViewCustom JobsTab PodsTab`
- ✅ `npm test --prefix frontend -- useTableSort BrowseView useBrowseCatalog browseCatalogData queryBackedLeafFirstLoad useQueryBackedResourceGridTable useResourceGridTable`
