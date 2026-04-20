# Frontend Data Fetch Inventory

Last updated: 2026-04-19

This document inventories the frontend-initiated data fetch paths in the app.

Scope:

- Includes every current frontend read path that fetches data from the backend or refresh subsystem.
- Includes refresh-domain fetches, direct Wails RPC reads, and capability/permission queries.
- Excludes write/mutation calls such as delete, scale, suspend, rollback, cordon, port-forward start/stop, etc.
- Distinguishes between:
  - transport primitives
  - domain registrations
  - explicit fetch initiators
  - direct RPC readers

## Shared Transport Primitives

| Path                              | Implementation                                                                                           | Purpose                                                                                    | Files                                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Refresh snapshot HTTP             | `fetchSnapshot()` builds `GET /api/v2/snapshots/:domain?scope=...` after resolving `GetRefreshBaseURL()` | Pulls snapshot payloads for refresh domains                                                | `frontend/src/core/refresh/client.ts`                                                          |
| Refresh scheduler/manual dispatch | `RefreshManager` schedules refreshers and allows manual refresh while globally paused                    | Background cadence plus context-level manual refresh fan-out                               | `frontend/src/core/refresh/RefreshManager.ts`                                                  |
| Refresh orchestrator              | `refreshOrchestrator.fetchScopedDomain()` and `triggerManualRefreshForContext()`                         | Domain registration, scope enable/disable, streaming coordination, snapshot fetch fallback | `frontend/src/core/refresh/orchestrator.ts`                                                    |
| Resource stream transport         | `resourceStreamManager`                                                                                  | Streams most list-style resource domains; can `refreshOnce()` as fallback                  | `frontend/src/core/refresh/streaming/resourceStreamManager.ts`                                 |
| Event stream transport            | `eventStreamManager`                                                                                     | Streams cluster and namespace event domains                                                | `frontend/src/core/refresh/streaming/eventStreamManager.ts`                                    |
| Catalog stream transport          | `catalogStreamManager`                                                                                   | Streams browse/catalog payloads                                                            | `frontend/src/core/refresh/streaming/catalogStreamManager.ts`                                  |
| Log stream transport              | `logStreamManager`                                                                                       | Streams object log entries; supports one-shot refresh                                      | `frontend/src/core/refresh/streaming/logStreamManager.ts`                                      |
| Direct Wails RPC                  | Generated `@wailsjs/go/backend/App` bindings or runtime `window.go.backend.App.*`                        | One-off reads that do not use refresh domains                                              | various                                                                                        |
| Permission query RPC              | `window.go.backend.App.QueryPermissions()`                                                               | Namespace/cluster permission reads                                                         | `frontend/src/core/capabilities/permissionStore.ts`, `frontend/src/core/capabilities/hooks.ts` |
| Capability evaluation RPC         | `EvaluateCapabilities()`                                                                                 | Feature/capability evaluation batches                                                      | `frontend/src/core/capabilities/store.ts`                                                      |

## Refresh Domain Registry

All refresh domains are defined in `frontend/src/core/refresh/types.ts` and registered in `frontend/src/core/refresh/orchestrator.ts`.

| Domain                  | Data pulled                                                              | Transport                             | Category  | Primary consumers                                                |
| ----------------------- | ------------------------------------------------------------------------ | ------------------------------------- | --------- | ---------------------------------------------------------------- |
| `namespaces`            | Namespace list for active clusters, including workload presence metadata | Snapshot HTTP                         | system    | `NamespaceContext`, `Sidebar`                                    |
| `cluster-overview`      | Cluster overview counters, resource usage, metrics freshness             | Snapshot HTTP                         | system    | `ClusterOverview`, `useMetricsAvailability`                      |
| `object-maintenance`    | Node drain/maintenance jobs and events                                   | Snapshot HTTP                         | system    | `NodeMaintenanceTab`                                             |
| `object-details`        | Object panel structured details payload                                  | Snapshot HTTP                         | system    | `useObjectPanelRefresh`, details/jobs tabs                       |
| `object-events`         | Object-specific events                                                   | Snapshot HTTP                         | system    | `EventsTab`                                                      |
| `object-yaml`           | Object YAML manifest                                                     | Snapshot HTTP                         | system    | `YamlTab`, `ObjectDiffModal`                                     |
| `object-helm-manifest`  | Helm rendered manifest                                                   | Snapshot HTTP                         | system    | `ManifestTab`                                                    |
| `object-helm-values`    | Helm values payload                                                      | Snapshot HTTP                         | system    | `ValuesTab`                                                      |
| `object-logs`           | Object log entries and sequencing metadata                               | Log stream manager                    | system    | `LogViewer`                                                      |
| `pods`                  | Pod list plus metrics for namespace/workload/node scopes                 | Resource stream manager, metrics-only | system    | `NsResourcesContext`, `useObjectPanelPods`, `PodsTab`            |
| `catalog`               | Browse catalog rows, namespace groups, pagination metadata               | Catalog stream manager                | cluster   | `useBrowseCatalog`, `Sidebar`                                    |
| `catalog-diff`          | Catalog search results for object diff selection                         | Snapshot HTTP                         | cluster   | `ObjectDiffModal`                                                |
| `cluster-events`        | Cluster-wide events                                                      | Event stream manager                  | cluster   | `ClusterResourcesContext`, `ClusterViewEvents`                   |
| `nodes`                 | Node rows plus node metrics                                              | Resource stream manager, metrics-only | cluster   | `ClusterResourcesContext`, `ClusterViewNodes`, `NsViewWorkloads` |
| `cluster-rbac`          | Cluster roles and role bindings                                          | Resource stream manager               | cluster   | `ClusterResourcesContext`, `ClusterViewRBAC`                     |
| `cluster-storage`       | Persistent volumes and storage state                                     | Resource stream manager               | cluster   | `ClusterResourcesContext`, `ClusterViewStorage`                  |
| `cluster-config`        | Cluster-scoped config resources                                          | Resource stream manager               | cluster   | `ClusterResourcesContext`, `ClusterViewConfig`                   |
| `cluster-crds`          | CRD definitions                                                          | Resource stream manager               | cluster   | `ClusterResourcesContext`, `ClusterViewCRDs`                     |
| `cluster-custom`        | Cluster-scoped custom resources                                          | Resource stream manager               | cluster   | `ClusterResourcesContext`, `ClusterViewCustom`                   |
| `namespace-events`      | Namespace-scoped events                                                  | Event stream manager                  | namespace | `NsResourcesContext`, `NsViewEvents`                             |
| `namespace-workloads`   | Workloads plus workload metrics                                          | Resource stream manager, metrics-only | namespace | `NsResourcesContext`, `NsViewWorkloads`                          |
| `namespace-config`      | Namespace config resources                                               | Resource stream manager               | namespace | `NsResourcesContext`, `NsViewConfig`                             |
| `namespace-network`     | Namespace network resources                                              | Resource stream manager               | namespace | `NsResourcesContext`, `NsViewNetwork`                            |
| `namespace-rbac`        | Namespace RBAC resources                                                 | Resource stream manager               | namespace | `NsResourcesContext`, `NsViewRBAC`                               |
| `namespace-storage`     | Namespace storage resources                                              | Resource stream manager               | namespace | `NsResourcesContext`, `NsViewStorage`                            |
| `namespace-autoscaling` | HPAs and autoscaling summaries                                           | Resource stream manager               | namespace | `NsResourcesContext`, `NsViewAutoscaling`                        |
| `namespace-quotas`      | Quotas and limits                                                        | Resource stream manager               | namespace | `NsResourcesContext`, `NsViewQuotas`                             |
| `namespace-custom`      | Namespace-scoped custom resources                                        | Resource stream manager               | namespace | `NsResourcesContext`, `NsViewCustom`                             |
| `namespace-helm`        | Helm releases in a namespace                                             | Resource stream manager               | namespace | `NsResourcesContext`, `NsViewHelm`                               |

## Explicit Refresh Initiators

These are the frontend call sites that actively request refresh data. This is the main source of the current “multiple fetch paths” problem.

### Context-Level Manual Refresh Fan-Out

These use `refreshOrchestrator.triggerManualRefreshForContext()`, which delegates to `RefreshManager.triggerManualRefreshForContext()`.

| File                                                         | Trigger                                       | Data pulled                                        |
| ------------------------------------------------------------ | --------------------------------------------- | -------------------------------------------------- |
| `frontend/src/App.tsx`                                       | Global manual refresh shortcut (`Cmd/Ctrl+R`) | Whatever refreshers match the current view context |
| `frontend/src/core/contexts/ViewStateContext.tsx`            | View type change                              | Whatever refreshers match the new context          |
| `frontend/src/ui/command-palette/CommandPaletteCommands.tsx` | “Refresh Current View” command                | Whatever refreshers match the current context      |
| `frontend/src/ui/status/ConnectivityStatus.tsx`              | “Refresh Now” action                          | Whatever refreshers match the current context      |

### Direct `fetchScopedDomain(...)` Initiators

These bypass the context fan-out and request a specific domain/scope directly.

| File                                                                                          | Domain(s)                                                                                                        | Trigger                                                                       | Data pulled                                       |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------- |
| `frontend/src/modules/namespace/contexts/NamespaceContext.tsx`                                | `namespaces`                                                                                                     | provider load, cluster selection changes, manual namespace refresh            | Namespace list                                    |
| `frontend/src/modules/namespace/contexts/NsResourcesContext.tsx`                              | `pods`, all `namespace-*` domains                                                                                | active namespace view activation, namespace change, explicit resource refresh | Namespace resource lists and pod/metric snapshots |
| `frontend/src/modules/browse/hooks/useBrowseCatalog.ts`                                       | `catalog`                                                                                                        | scope/query change, metadata scope refresh, pagination/load more              | Browse catalog rows, metadata catalogs            |
| `frontend/src/modules/cluster/components/ClusterOverview.tsx`                                 | `cluster-overview`                                                                                               | overview mount and kubeconfig change                                          | Cluster overview counters/metrics                 |
| `frontend/src/core/refresh/hooks/useMetricsAvailability.ts`                                   | `cluster-overview`                                                                                               | non-overview views priming metrics state                                      | Cluster overview metrics                          |
| `frontend/src/modules/cluster/contexts/ClusterResourcesContext.tsx`                           | `nodes`, `cluster-rbac`, `cluster-storage`, `cluster-config`, `cluster-crds`, `cluster-custom`, `cluster-events` | active cluster view activation, explicit load/refresh                         | Cluster resource lists                            |
| `frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelRefresh.ts`     | `object-details`                                                                                                 | panel open, explicit detail refresh                                           | Object details payload                            |
| `frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelPods.ts`        | `pods`                                                                                                           | pods tab activation                                                           | Pod list/metrics for node or workload scope       |
| `frontend/src/modules/object-panel/components/ObjectPanel/Events/EventsTab.tsx`               | `object-events`                                                                                                  | events tab activation, refresh watcher                                        | Object events                                     |
| `frontend/src/modules/object-panel/components/ObjectPanel/Yaml/YamlTab.tsx`                   | `object-yaml`                                                                                                    | YAML tab activation, post-save refresh, merge/reload paths                    | Object YAML                                       |
| `frontend/src/modules/object-panel/components/ObjectPanel/Helm/ManifestTab.tsx`               | `object-helm-manifest`                                                                                           | manifest tab activation                                                       | Helm rendered manifest                            |
| `frontend/src/modules/object-panel/components/ObjectPanel/Helm/ValuesTab.tsx`                 | `object-helm-values`                                                                                             | values tab activation                                                         | Helm values payload                               |
| `frontend/src/modules/object-panel/components/ObjectPanel/Maintenance/NodeMaintenanceTab.tsx` | `object-maintenance`                                                                                             | maintenance tab activation, explicit refresh                                  | Node maintenance/drain jobs                       |
| `frontend/src/ui/modals/ObjectDiffModal.tsx`                                                  | `catalog-diff`, `object-yaml`                                                                                    | diff modal side selection changes                                             | Catalog search results and selected object YAML   |

## Direct Wails RPC Read Inventory

These fetch data outside the refresh domain system.

| File                                                                                  | RPC(s)                                                            | Data pulled                                                  | Current implementation                                       |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| `frontend/src/modules/kubernetes/config/KubeconfigContext.tsx`                        | `GetKubeconfigs`, `GetSelectedKubeconfigs`                        | Available kubeconfigs and active selection                   | Direct Wails read on provider load and rollback confirmation |
| `frontend/src/core/settings/appPreferences.ts`                                        | `GetAppSettings`, `GetThemes`                                     | Persisted app preferences and saved themes                   | Direct Wails reads inside preference/theme helpers           |
| `frontend/src/ui/settings/Settings.tsx`                                               | `GetThemeInfo`, `GetKubeconfigSearchPaths`                        | Theme metadata and kubeconfig search paths                   | Direct Wails reads when settings UI loads those sections     |
| `frontend/src/core/contexts/AuthErrorContext.tsx`                                     | `GetAllClusterAuthStates`                                         | Initial auth state for all clusters                          | Direct Wails read on provider mount                          |
| `frontend/src/core/contexts/ClusterLifecycleContext.tsx`                              | `GetAllClusterLifecycleStates`                                    | Current lifecycle state for every cluster                    | Direct Wails read on provider mount / sync path              |
| `frontend/src/ui/modals/AboutModal.tsx`                                               | `GetAppInfo`                                                      | App version/update metadata                                  | Direct Wails read on modal open                              |
| `frontend/src/modules/cluster/components/ClusterOverview.tsx`                         | `GetAppInfo`                                                      | App version/update metadata for overview banner              | Direct Wails read on overview mount                          |
| `frontend/src/ui/panels/app-logs/AppLogsPanel.tsx`                                    | `GetLogs`                                                         | App log buffer entries                                       | Direct Wails read via `loadLogs()`                           |
| `frontend/src/modules/port-forward/PortForwardsPanel.tsx`                             | `ListPortForwards`                                                | Active port-forward sessions                                 | Direct Wails read on panel refresh                           |
| `frontend/src/ui/status/SessionsStatus.tsx`                                           | `ListShellSessions`, `ListPortForwards`                           | Active shell sessions and port-forward sessions              | Direct Wails reads for status tooltip                        |
| `frontend/src/modules/port-forward/PortForwardModal.tsx`                              | `GetTargetPorts`                                                  | Candidate target ports for selected workload/pod             | Direct Wails read before starting a port-forward             |
| `frontend/src/ui/layout/ClusterTabs.tsx`                                              | `GetClusterPortForwardCount`                                      | Active port-forward count for a cluster tab                  | Direct Wails read when closing a cluster tab                 |
| `frontend/src/modules/object-panel/components/ObjectPanel/Shell/ShellTab.tsx`         | `GetPodContainers`, `ListShellSessions`, `GetShellSessionBacklog` | Pod container list, existing shell sessions, backlog replay  | Direct Wails reads during shell attach/reconnect             |
| `frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogViewer.tsx`         | `GetLogScopeContainers`                                           | Container inventory for the current log scope                | Direct Wails read when log scope changes                     |
| `frontend/src/modules/object-panel/components/ObjectPanel/Yaml/YamlTab.tsx`           | `GetObjectYAMLByGVK`                                              | Fresh YAML for strict GVK identity                           | Direct Wails read during stale/merge recovery                |
| `frontend/src/ui/modals/ObjectDiffModal.tsx`                                          | `FindCatalogObjectMatch`                                          | Catalog object resolution for left/right diff selections     | Direct Wails read when diff side search/selection changes    |
| `frontend/src/shared/utils/eventObjectIdentity.ts`                                    | `FindCatalogObjectByUID`                                          | Resolve event involved-object UID to a catalog object        | Direct Wails read during event object linking                |
| `frontend/src/shared/components/modals/RollbackModal.tsx`                             | `GetRevisionHistory`                                              | Rollout revision history                                     | Direct Wails read when rollback modal opens                  |
| `frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/index.tsx` | `IsWorkloadHPAManaged`                                            | Whether an HPA manages the current workload                  | Direct Wails read in scalable workload overview              |
| `frontend/src/core/persistence/favorites.ts`                                          | `GetFavorites`                                                    | Saved favorites                                              | Direct Wails read from persistence helper                    |
| `frontend/src/shared/components/tables/persistence/gridTablePersistence.ts`           | `GetGridTablePersistence`                                         | Saved grid table layout/filter persistence                   | Direct Wails read from persistence helper                    |
| `frontend/src/core/persistence/clusterTabOrder.ts`                                    | `GetClusterTabOrder`                                              | Saved cluster tab ordering                                   | Direct Wails read from persistence helper                    |
| `frontend/src/core/contexts/ZoomContext.tsx`                                          | `GetZoomLevel`                                                    | Saved zoom level                                             | Direct Wails read on provider mount                          |
| `frontend/src/core/refresh/client.ts`                                                 | `GetRefreshBaseURL`, `GetSelectionDiagnostics`                    | Base URL for refresh HTTP API; selection diagnostics payload | Direct Wails reads used by refresh client/diagnostics        |

## Planned Ownership Decisions

These decisions align the inventory with the two-path migration plan.

### `appStateAccess` ownership

These are bootstrap/app-state reads and should migrate through `appStateAccess`.

| File                                                                        | RPC(s)                             | Why |
| --------------------------------------------------------------------------- | ---------------------------------- | --- |
| `frontend/src/modules/kubernetes/config/KubeconfigContext.tsx`              | `GetKubeconfigs`, `GetSelectedKubeconfigs` | Bootstrap app shell cluster selection state |
| `frontend/src/core/settings/appPreferences.ts`                              | `GetAppSettings`, `GetThemes`      | Persisted app configuration |
| `frontend/src/ui/settings/Settings.tsx`                                     | `GetThemeInfo`, `GetKubeconfigSearchPaths` | App settings/config metadata |
| `frontend/src/core/contexts/AuthErrorContext.tsx`                           | `GetAllClusterAuthStates`          | App-shell cluster auth state, not resource data |
| `frontend/src/core/contexts/ClusterLifecycleContext.tsx`                    | `GetAllClusterLifecycleStates`     | App-shell cluster lifecycle state, not resource data |
| `frontend/src/ui/modals/AboutModal.tsx`                                     | `GetAppInfo`                       | App metadata |
| `frontend/src/modules/cluster/components/ClusterOverview.tsx`               | `GetAppInfo`                       | App metadata reused in a cluster view |
| `frontend/src/core/persistence/favorites.ts`                                | `GetFavorites`                     | Persisted app/user state |
| `frontend/src/shared/components/tables/persistence/gridTablePersistence.ts` | `GetGridTablePersistence`          | Persisted app/user state |
| `frontend/src/core/persistence/clusterTabOrder.ts`                          | `GetClusterTabOrder`               | Persisted app/user state |
| `frontend/src/core/contexts/ZoomContext.tsx`                                | `GetZoomLevel`                     | Persisted app/user state |

### `dataAccess` ownership

These are cluster-derived reads and should migrate through `dataAccess`, even when they currently use direct RPCs.

| File                                                                                  | RPC(s)                                    | Why |
| ------------------------------------------------------------------------------------- | ----------------------------------------- | --- |
| `frontend/src/modules/object-panel/components/ObjectPanel/Yaml/YamlTab.tsx`           | `GetObjectYAMLByGVK`                      | Strict-GVK object read for cluster data recovery |
| `frontend/src/ui/modals/ObjectDiffModal.tsx`                                          | `FindCatalogObjectMatch`                  | Cluster object resolution |
| `frontend/src/shared/utils/eventObjectIdentity.ts`                                    | `FindCatalogObjectByUID`                  | Cluster object resolution |
| `frontend/src/shared/components/modals/RollbackModal.tsx`                             | `GetRevisionHistory`                      | Cluster workload revision data |
| `frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/index.tsx` | `IsWorkloadHPAManaged`                    | Cluster workload capability/state read |
| `frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogViewer.tsx`         | `GetLogScopeContainers`                   | Container inventory derived from cluster object scope |
| `frontend/src/modules/object-panel/components/ObjectPanel/Shell/ShellTab.tsx`         | `GetPodContainers`                        | Container inventory derived from cluster object scope |
| `frontend/src/modules/port-forward/PortForwardModal.tsx`                              | `GetTargetPorts`                          | Cluster object/service port discovery |

### Deferred operational/session reads

These should not be forced into `appStateAccess` or `dataAccess` during the first migration. They are runtime operational/session state and need their own follow-up classification.

| File                                                                          | RPC(s)                                          | Why deferred |
| ----------------------------------------------------------------------------- | ----------------------------------------------- | ------------ |
| `frontend/src/ui/panels/app-logs/AppLogsPanel.tsx`                            | `GetLogs`                                       | App runtime log buffer, not bootstrap or cluster resource data |
| `frontend/src/modules/port-forward/PortForwardsPanel.tsx`                     | `ListPortForwards`                              | Runtime session inventory |
| `frontend/src/ui/status/SessionsStatus.tsx`                                   | `ListShellSessions`, `ListPortForwards`         | Runtime session inventory |
| `frontend/src/ui/layout/ClusterTabs.tsx`                                      | `GetClusterPortForwardCount`                    | Runtime session count |
| `frontend/src/modules/object-panel/components/ObjectPanel/Shell/ShellTab.tsx` | `ListShellSessions`, `GetShellSessionBacklog`   | Runtime session state/backlog |

### Internal infrastructure reads

These stay internal to infrastructure/adapters and are not component-level broker targets.

| File                                  | RPC(s)                                     | Why |
| ------------------------------------- | ------------------------------------------ | --- |
| `frontend/src/core/refresh/client.ts` | `GetRefreshBaseURL`, `GetSelectionDiagnostics` | Transport/bootstrap plumbing for refresh infrastructure |

## Capability and Permission Read Inventory

These are separate fetch systems today.

| File                                                                       | API                                        | Data pulled                                           | Current implementation                                   |
| -------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------- | -------------------------------------------------------- |
| `frontend/src/core/capabilities/permissionStore.ts`                        | `window.go.backend.App.QueryPermissions()` | Namespace/cluster permission results plus diagnostics | Local typed wrapper around a Wails RPC                   |
| `frontend/src/core/capabilities/hooks.ts`                                  | `window.go.backend.App.QueryPermissions()` | Hook-level permission query batches                   | Same RPC, separate wrapper path                          |
| `frontend/src/core/capabilities/store.ts`                                  | `EvaluateCapabilities()`                   | Capability results for feature descriptors            | Generated Wails binding                                  |
| `frontend/src/modules/namespace/contexts/NamespaceContext.tsx`             | `queryNamespacePermissions(...)`           | Permissions for selected namespace / all namespaces   | Frontend helper that eventually calls `QueryPermissions` |
| `frontend/src/modules/namespace/contexts/NsResourcesContext.tsx`           | `queryNamespacePermissions(...)`           | Permissions for active/all namespace resources        | Same helper path                                         |
| `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanel.tsx` | `queryNamespacePermissions(...)`           | Permissions for the panel object’s namespace          | Same helper path                                         |

## Current Fetch Path Summary

Today the frontend has four separate read paths:

1. RefreshManager-driven refreshers
2. Direct `refreshOrchestrator.fetchScopedDomain(...)` calls from components/providers
3. Direct Wails RPC reads
4. Capability/permission RPC reads

That is why the app feels inconsistent around concepts like:

- auto-refresh paused
- startup load vs user refresh
- view activation
- direct one-off reads that never enter refresh diagnostics

## Migration Constraints For Two Read Paths

Any migration to the new broker model has to preserve these cases:

- background scheduled refresh
- startup/activation fetch
- explicit user refresh
- scoped one-shot reads
- streaming subscriptions
- non-refresh bootstrap/app-state reads such as settings, favorites, zoom, app info
- capability/permission reads

The clean target is not “everything becomes a refresher interval.” The clean target is:

- one bootstrap/app-state entrypoint
- one cluster-data entrypoint
- one request reason model for cluster data only
  - `background`
  - `startup`
  - `user`
  - not bootstrap/app-state reads
- one paused-policy gate for cluster-data behavior
- diagnostics that can cover both paths without forcing them into identical semantics

That would let the app answer, for every piece of data:

- who asked for it
- why it was allowed
- which transport handled it
- whether it should run while auto-refresh is paused
- whether it is bootstrap/app-state, cluster data, or intentionally deferred
