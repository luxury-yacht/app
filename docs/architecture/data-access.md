# Data Access

This document defines how frontend-initiated reads reach backend data. It is the
contract for choosing between refresh domains, direct RPC adapters, and
permission/capability reads.

## Core Contract

Component code must not call transport helpers directly.

- no component-level `fetchScopedDomain(...)`
- no component-level `triggerManualRefreshForContext(...)`
- no component-level cluster-data Wails RPC reads
- no component-level direct `QueryPermissions`

Use these two public brokers:

- `dataAccess` for cluster/resource reads
- `appStateAccess` for bootstrap, app-shell, persisted-state, and runtime
  operational reads

Underlying transports may still vary. The broker path is the stable frontend
contract.

## Broker Ownership

Use `appStateAccess` for:

- settings, themes, zoom, favorites, and persisted layout state
- kubeconfig inventory and selection state
- app info and version metadata
- app-shell auth and cluster lifecycle hydration
- application logs and runtime session inventories
- shell and port-forward session lists/backlogs

`appStateAccess` does not participate in cluster refresh policy. It should not
know about paused auto-refresh, background refresh, startup refresh, or
refresh-domain streaming semantics.

Use `dataAccess` for:

- refresh-domain backed cluster/resource data
- cluster-derived direct RPC reads
- permission and capability reads

Every cluster/resource read must go through `dataAccess`, regardless of whether
the underlying transport is a refresh domain, a direct Wails RPC, or a
permission/capability helper.

## Transport Adapters

| Adapter                  | Broker           | Purpose                                                                                                                                            |
| ------------------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `refresh-domain`         | `dataAccess`     | Snapshot, streaming, and fallback reads for refresh domains                                                                                        |
| `permission-read`        | `dataAccess`     | `QueryPermissions` batches and diagnostics                                                                                                         |
| `capability-read`        | `dataAccess`     | Resource capability queries where needed                                                                                                           |
| cluster-data RPC readers | `dataAccess`     | Strict object reads such as YAML recovery, catalog resolution, revision history, HPA ownership, pod/container inventory, and target port discovery |
| `rpc-read`               | `appStateAccess` | App state and runtime reads through Wails bindings                                                                                                 |
| `persistence-read`       | `appStateAccess` | Saved preferences, table layout, favorites, zoom, and tab order                                                                                    |

Internal infrastructure reads such as `GetRefreshBaseURL` and
`GetSelectionDiagnostics` stay inside refresh client/diagnostics plumbing.

## Refresh Domains

Refresh domains are defined in `frontend/src/core/refresh/types.ts` and
registered in `frontend/src/core/refresh/orchestrator.ts`.

| Domain                  | Data                                                       | Transport                             | Primary consumers                           |
| ----------------------- | ---------------------------------------------------------- | ------------------------------------- | ------------------------------------------- |
| `namespaces`            | Namespace list and workload presence metadata              | Snapshot HTTP                         | `NamespaceContext`, `Sidebar`               |
| `cluster-overview`      | Cluster counters, resource usage, metrics freshness        | Snapshot HTTP                         | `ClusterOverview`, `useMetricsAvailability` |
| `object-maintenance`    | Node drain/maintenance jobs and events                     | Snapshot HTTP                         | Node drain status UI                        |
| `object-details`        | Object panel structured details                            | Snapshot HTTP                         | object panel details/jobs tabs              |
| `object-events`         | Object-specific events                                     | Snapshot HTTP                         | object panel Events tab                     |
| `object-yaml`           | Object YAML manifest                                       | Snapshot HTTP                         | YAML tab, diff modal                        |
| `object-helm-manifest`  | Helm rendered manifest                                     | Snapshot HTTP                         | Manifest tab                                |
| `object-helm-values`    | Helm values payload                                        | Snapshot HTTP                         | Values tab                                  |
| `container-logs`        | Container log entries and sequencing metadata              | Container logs stream manager         | `LogViewer`                                 |
| `pods`                  | Pod list plus metrics for namespace/workload/node scopes   | Resource stream manager, metrics-only | namespace resources, object-panel Pods tab  |
| `catalog`               | Browse catalog rows, namespace groups, pagination metadata | Catalog stream manager                | browse view, sidebar                        |
| `catalog-diff`          | Catalog search results for object diff selection           | Snapshot HTTP                         | Object Diff modal                           |
| `cluster-events`        | Cluster-wide events                                        | Event stream manager                  | cluster Events view                         |
| `nodes`                 | Node rows plus node metrics                                | Resource stream manager, metrics-only | cluster Nodes view, workload node summaries |
| `cluster-rbac`          | Cluster roles and role bindings                            | Resource stream manager               | cluster RBAC view                           |
| `cluster-storage`       | Persistent volumes and storage state                       | Resource stream manager               | cluster Storage view                        |
| `cluster-config`        | Cluster-scoped config resources                            | Resource stream manager               | cluster Config view                         |
| `cluster-crds`          | CRD definitions                                            | Resource stream manager               | cluster CRDs view                           |
| `cluster-custom`        | Cluster-scoped custom resources                            | Resource stream manager               | cluster Custom view                         |
| `namespace-events`      | Namespace-scoped events                                    | Event stream manager                  | namespace Events view                       |
| `namespace-workloads`   | Workloads plus workload metrics                            | Resource stream manager, metrics-only | namespace Workloads view                    |
| `namespace-config`      | Namespace config resources                                 | Resource stream manager               | namespace Config view                       |
| `namespace-network`     | Namespace network resources                                | Resource stream manager               | namespace Network view                      |
| `namespace-rbac`        | Namespace RBAC resources                                   | Resource stream manager               | namespace RBAC view                         |
| `namespace-storage`     | Namespace storage resources                                | Resource stream manager               | namespace Storage view                      |
| `namespace-autoscaling` | HPAs and autoscaling summaries                             | Resource stream manager               | namespace Autoscaling view                  |
| `namespace-quotas`      | Quotas and limits                                          | Resource stream manager               | namespace Quotas view                       |
| `namespace-custom`      | Namespace-scoped custom resources                          | Resource stream manager               | namespace Custom view                       |
| `namespace-helm`        | Helm releases in a namespace                               | Resource stream manager               | namespace Helm view                         |

Older list-style Wails methods such as `GetWorkloads` are retired. Frontend
table data should use refresh domains.

## Request Reasons

Cluster/resource reads use explicit request intent instead of boolean `manual`
flags:

- `background`: scheduler-driven upkeep
- `startup`: passive view/tab/panel activation
- `user`: explicit user action such as `Refresh Now`

When auto-refresh is disabled:

| Reason       | Allowed? |
| ------------ | -------- |
| `background` | No       |
| `startup`    | No       |
| `user`       | Yes      |

This keeps paused cluster-data behavior consistent:

- no passive cluster-data fetches while paused
- no passive loading spinners while paused
- explicit user refresh still works

## Scope Rules

All request scopes must preserve cluster identity:

- cluster-scoped reads include `clusterId`
- namespace-scoped reads include `clusterId` and namespace
- object-scoped reads include `clusterId`, `group`, `version`, `kind`, and
  object identity

Foreground views scope reads to the active cluster only. Multi-cluster scopes
are valid only for intentionally aggregated, background, or system behavior.

## Loading And Diagnostics

Cluster-data UI derives loading behavior from broker request state, not from
transport status alone.

Important cluster-data states:

- `idle`
- `loading`
- `refreshing`
- `ready`
- `error`
- `blocked`

`blocked` is the paused-startup state for cluster data. `appStateAccess` reads
can keep a simpler lifecycle because they do not participate in cluster refresh
semantics.

Broker diagnostics should answer:

- what requested the data
- why it was requested
- whether it was blocked while paused
- which adapter serviced it
- whether it hit cache or backend
- whether it is currently loading, blocked, or errored

## Current Read Path Summary

The clean target is:

- one bootstrap/app-state entrypoint
- one cluster-data entrypoint
- one request reason model for cluster data only: `background`, `startup`,
  `user`
- one paused-policy gate for cluster-data behavior
- diagnostics that cover both paths without forcing them into identical
  semantics

That lets the app answer, for every piece of data:

- who asked for it
- why it was allowed
- which transport handled it
- whether it should run while auto-refresh is paused
- whether it is bootstrap/app-state, cluster data, or intentionally deferred
