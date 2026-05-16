# Data Access

This document defines how frontend-initiated reads reach backend data. It is the
contract for choosing between refresh domains, direct RPC adapters,
permission/capability reads, and app-state reads.

## Core Contract

Frontend reads must go through one of two brokers:

- `dataAccess` for cluster/resource reads
- `appStateAccess` for bootstrap, app-shell, persisted-state, and runtime
  operational reads

Component and feature hook code should not call these directly:

- `fetchScopedDomain(...)`
- `triggerManualRefreshForContext(...)`
- cluster-data generated Wails read bindings
- `QueryPermissions`

Add a typed reader in `frontend/src/core/data-access/readers.ts` or
`frontend/src/core/app-state-access/readers.ts`, then invoke it through the
owning broker.

This policy covers reads. Commands and mutations such as apply, delete,
port-forward, shell, and suspend/resume operations may use action-specific
bindings, but they must still carry complete cluster and object identity.

## Broker Ownership

Use `dataAccess` for:

- refresh-domain backed cluster/resource data
- context refreshes that fan out across domains
- cluster-derived direct RPC reads
- permission and capability reads

Every cluster/resource read must use `dataAccess`, regardless of whether the
transport is a refresh domain, direct Wails RPC, or permission/capability
helper. Non-user `dataAccess` reads are subject to the paused auto-refresh
policy.

Use `appStateAccess` for:

- settings, themes, zoom, favorites, layout state, and other persisted app state
- kubeconfig inventory and selection state
- app info and version metadata
- app-shell auth and cluster lifecycle hydration
- application logs and runtime session inventories
- shell and port-forward session lists/backlogs

`appStateAccess` does not participate in cluster refresh policy. It should not
know about paused auto-refresh, background refresh, startup refresh, or
refresh-domain streaming semantics.

## Adapters

Adapters describe how a broker read is serviced for diagnostics and policy.

| Adapter            | Broker           | Purpose                                                                 |
| ------------------ | ---------------- | ----------------------------------------------------------------------- |
| `refresh-domain`   | `dataAccess`     | Snapshot, streaming, and fallback reads for refresh domains             |
| `context-refresh`  | `dataAccess`     | Manual refreshes for active cluster, namespace, or object context       |
| `rpc-read`         | `dataAccess`     | Direct cluster/resource reads through typed Wails reader wrappers       |
| `permission-read`  | `dataAccess`     | `QueryPermissions` batches and diagnostics                              |
| `capability-read`  | `dataAccess`     | Resource capability queries where needed                                |
| `rpc-read`         | `appStateAccess` | App-state and runtime reads through typed Wails reader wrappers         |
| `persistence-read` | `appStateAccess` | Saved preferences, table layout, favorites, zoom, and tab order         |
| `runtime-read`     | `appStateAccess` | Runtime inventories such as app logs, sessions, and lifecycle snapshots |

Internal infrastructure reads such as `GetRefreshBaseURL` and
`GetSelectionDiagnostics` stay inside refresh client/diagnostics plumbing.

## Typed Readers

`dataAccess` reader wrappers currently cover:

- target ports, pod containers, and log-scope containers
- object YAML by GVK
- catalog object lookup by UID or object match
- revision history
- HPA ownership checks
- permission queries

`appStateAccess` reader wrappers currently cover:

- kubeconfig inventory and selected kubeconfigs
- settings, saved themes, appearance mode info, zoom, and kubeconfig search paths
- app info and application logs
- auth and cluster lifecycle snapshots
- port-forward and shell session inventories/backlogs

Reader wrappers are the only place generated Wails read imports should be
needed for these paths.

## Refresh Domains

Refresh domains are defined in `frontend/src/core/refresh/types.ts`,
registered in `frontend/src/core/refresh/registrations.ts`, and described in
more detail in [Refresh System](refresh-system.md).

| Domains                                                                                                                                                                              | Data                                                                                               | Transport                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `namespaces`, `cluster-overview`, `object-maintenance`, `object-details`, `object-events`, `object-yaml`, `object-helm-manifest`, `object-helm-values`, `object-map`, `catalog-diff` | Namespace/sidebar, cluster overview, object panel, YAML/diff, Helm, map, and catalog-diff payloads | Snapshot HTTP                                |
| `catalog`                                                                                                                                                                            | Browse catalog rows, namespace groups, filter results, and pagination metadata                     | Catalog stream manager plus snapshot fetches |
| `pods`, `nodes`, `namespace-workloads`                                                                                                                                               | Rows from streams plus metrics-only snapshot updates                                               | Resource stream manager, metrics-only        |
| `cluster-events`, `namespace-events`                                                                                                                                                 | Cluster-wide and namespace-scoped events                                                           | Event stream manager                         |
| `container-logs`                                                                                                                                                                     | Container log entries and sequencing metadata                                                      | Container logs stream manager                |
| `cluster-rbac`, `cluster-storage`, `cluster-config`, `cluster-crds`, `cluster-custom`                                                                                                | Cluster-scoped resources                                                                           | Resource stream manager                      |
| `namespace-config`, `namespace-network`, `namespace-rbac`, `namespace-storage`, `namespace-autoscaling`, `namespace-quotas`, `namespace-custom`, `namespace-helm`                    | Namespace-scoped resources                                                                         | Resource stream manager                      |

Older list-style Wails methods such as `GetWorkloads` are retired. Frontend
table data should use refresh domains.

## Request Reasons

Cluster/resource reads use explicit request intent instead of boolean `manual`
flags:

- `background`: scheduler-driven upkeep
- `startup`: passive view/tab/panel activation
- `user`: explicit user action such as Refresh Now

When auto-refresh is disabled:

| Reason       | Allowed? |
| ------------ | -------- |
| `background` | No       |
| `startup`    | No       |
| `user`       | Yes      |

Blocked non-user reads return `status: "blocked"` with
`blockedReason: "auto-refresh-disabled"` and should not show passive loading
spinners. User-initiated refreshes still run while paused.

`appStateAccess` has no request reason and no paused-read gate.

## Scope Rules

All cluster/resource request scopes must preserve Kubernetes identity:

- cluster-scoped reads include `clusterId`
- namespace-scoped reads include `clusterId` and namespace
- object-scoped reads include `clusterId`, `group`, `version`, `kind`, and
  object identity

Foreground views scope reads to the active cluster only. Refresh-domain reads
always use one cluster scope at a time; background refresh and cross-cluster
displays fan out across per-cluster state instead of using aggregate refresh
scopes.

## Loading And Diagnostics

Broker results and UI refresh state are related but not identical.

`dataAccess` returns only whether a read was `executed` or `blocked`. Refresh
domain lifecycle state such as loading, initialising, updating, ready, or error
comes from the refresh store for that domain. Direct brokered RPC reads keep
their local UI loading/error state while reporting diagnostics through the
broker.

Broker diagnostics should answer:

- what requested the data
- why it was requested, for `dataAccess`
- whether it was blocked while paused
- which broker and adapter serviced it
- which scope was requested
- whether the latest request succeeded, errored, or was blocked
- whether a request is currently in flight

## Adding A Read

When adding a frontend read:

1. Classify it as cluster/resource data or app-state/runtime data.
2. Add a typed reader wrapper under the owning broker package.
3. Call the reader through `requestData(...)`, `requestRefreshDomain(...)`,
   `requestContextRefresh(...)`, or `requestAppState(...)`.
4. Set `resource`, `adapter`, `label`, and `scope` for diagnostics.
5. For `dataAccess`, choose the correct reason: `background`, `startup`, or
   `user`, and handle `blocked` for non-user reads.
6. Preserve complete cluster and object identity across the request boundary.
