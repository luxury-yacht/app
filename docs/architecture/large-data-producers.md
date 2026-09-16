# Large Data Producer Reference

Use for changes to a named resource family, or an audit of the producer and
consumer paths. Search for the affected family; do not load this inventory for
local column or styling work. Shared rules live in [large data](large-data.md).

## High-Risk Typed Producer Trace

Pods: `backend/refresh/snapshot/pods.go` feeds namespace and all-namespaces pod
tables. It carries pod identity, status, restart, readiness, node, owner, and
metrics projection state. All-namespaces Pods are `Query Backed Dynamic`:
search, namespace/status/node filters, health predicates, pagination, and
CPU/memory sort are backend-owned for the current metrics snapshot. Status and
node dropdown options describe the full structural scope rather than the current
page or selected subset. Pod rows are served from a maintained `querypage` store
fed by the owned-reflector ingest path (a keyset range scan with exact
facet/total counters; metrics are overlaid at serve, never stored) — see
[data-layer.md](./data-layer.md).

Workloads: `backend/refresh/snapshot/namespace_workloads.go` feeds namespace
workload tables. Both single-namespace and all-namespaces workload tables are
`Query Backed Dynamic` (single-namespace runs a namespace-scoped query page):
kind, namespace, and status filters, search, pagination, and CPU/memory aggregate
sorts are backend-owned for the current metrics snapshot. Status options cover
the full structural namespace scope and remain available when a Status selection
or fixed health predicate narrows the result set. Like Pods, workload rows serve
from a maintained `querypage` store fed by the workload GVRs' ingest reflectors,
with the pod-aggregate / HPA / metrics join applied at serve — see
[data-layer.md](./data-layer.md).

The namespace Workloads destination composes two independent query-backed
tables: Workloads above and Pods below. Each table retains its own filter,
sort, cursor pagination, page size, diagnostics, and persisted GridTable state.
The split starts at 50% and supports pointer and keyboard resizing through a
handle directly on the pane boundary; it has no separate divider band. The Pods
pane boundary retains a one-pixel separator so the drag handle remains visible;
hovering or dragging thickens it to the shared resize highlight. The Pods pane
can be collapsed from the left edge of its own GridTable filter bar. While
collapsed, the one-pixel boundary remains and the Pods row becomes a compact
header containing only the expand control and `Show Pods`; expanding restores
the full filter bar and table. Pointer resizing cancels native selection at
gesture start and disables both standard and WebKit text selection for the
gesture, including while the pointer crosses the native app-window boundary.
Selecting a Workloads row writes the normal Pods GridTable filters: Namespace
when the table spans all namespaces, plus the provider-owned Owner facet. Owner
values carry cluster, group, version, kind, namespace, and name. Deployments
resolve through ReplicaSets, CronJobs resolve through Jobs, direct owners match
directly, and an ownerless Pod uses its own core/v1 identity. The projected Pod
row retains both direct-controller and resolved-ancestor identities; no
generated name parsing is part of the descendant contract. Manually changing
Namespace or Owner clears the Workloads row highlight without restoring the
previous filters. Changing the cluster or pinned namespace while a workload row
is selected clears that selection's Owner filter before querying the new scope;
an Owner filter with no active workload selection remains ordinary persisted
table state. The former standalone Pods navigation value is parsed as Workloads
for persisted-state compatibility.

Custom resources: cluster and namespace custom table row universes come from
the object catalog query path with `customOnly=true`. Search, kind filters,
sort, paging, counts, and facets for the visible table are owned by the backend
catalog query contract. The frontend hydrates only the current catalog page
through `HydrateCatalogCustomRows` to recover status, readiness, conditions,
labels, and annotations. Production Custom tabs do not subscribe to, enable, or
load the legacy `cluster-custom` and `namespace-custom` CRD fanout domains, and
they do not pass those full-row payloads through the Wails boundary. Those
legacy domains remain registered only for explicit resource-stream and
diagnostic compatibility surfaces; any future surface that enables them pays the
old full-CR-row fanout cost and must not be described as large-table-safe.

Events: cluster and namespace event tables use typed backend query pages over
the current event set and are `Query Backed Static` for table search, filters,
sort, counts, and cursor pagination. Object-panel events remain object-scoped
recent/capped windows and are visibly `Local Partial`.

Nodes: `backend/refresh/snapshot/nodes.go` feeds a `Query Backed Dynamic`
cluster table. Search, pagination, status filters, age sort, and CPU/memory
metric sorts are backend-owned for the current resource and metric projection
state. Node Status options cover the full cluster scope rather than the current
page or active Status selection.

Status, Owner, and Node are provider-owned query facets, not fixed typed-query fields.
Pods, Workloads, and Nodes publish generic facet descriptors in capabilities;
their responses pair those descriptors with full-structural-scope option values
and exactness. The shared request path serializes every selection as
`facet.<key>`, so adding another provider facet does not require a new GridTable
state field or view-local filter implementation.

Config, RBAC, storage, network, quotas, autoscaling, and Helm: these snapshot
producers expose typed backend query pages for cluster, all-namespaces, and
single-namespace surfaces alike. Single-namespace tables run a namespace-scoped
query page (`baseScope = namespace:<name>`) rather than a local-complete window,
so pagination and table semantics match every other scope.
