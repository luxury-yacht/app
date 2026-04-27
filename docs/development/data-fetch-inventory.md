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
| Container logs stream transport   | `containerLogsStreamManager`                                                                             | Streams container log entries; supports one-shot refresh                                   | `frontend/src/core/refresh/streaming/containerLogsStreamManager.ts`                            |
| Direct Wails RPC                  | Generated `@wailsjs/go/backend/App` bindings or runtime `window.go.backend.App.*`                        | One-off reads that do not use refresh domains                                              | various                                                                                        |
| Permission query RPC              | `window.go.backend.App.QueryPermissions()`                                                               | Namespace/cluster permission reads                                                         | `frontend/src/core/capabilities/permissionStore.ts`, `frontend/src/core/capabilities/hooks.ts` |

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
| `container-logs`        | Container log entries and sequencing metadata                            | Container logs stream manager         | system    | `LogViewer`                                                      |
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
| `frontend/src/ui/panels/app-logs/AppLogsPanel.tsx`                                    | `GetAppLogs`                                                      | Application Logs buffer entries                                       | Brokered via `appStateAccess.requestAppState(...)`           |
| `frontend/src/modules/port-forward/PortForwardsPanel.tsx`                             | `ListPortForwards`                                                | Active port-forward sessions                                 | Brokered via `appStateAccess.requestAppState(...)`           |
| `frontend/src/ui/status/SessionsStatus.tsx`                                           | `ListShellSessions`, `ListPortForwards`                           | Active shell sessions and port-forward sessions              | Brokered via `appStateAccess.requestAppState(...)`           |
| `frontend/src/modules/port-forward/PortForwardModal.tsx`                              | `GetTargetPorts`                                                  | Candidate target ports for selected workload/pod             | Direct Wails read before starting a port-forward             |
| `frontend/src/ui/layout/ClusterTabs.tsx`                                              | `GetClusterPortForwardCount`                                      | Active port-forward count for a cluster tab                  | Brokered via `appStateAccess.requestAppState(...)`           |
| `frontend/src/modules/object-panel/components/ObjectPanel/Shell/ShellTab.tsx`         | `GetPodContainers`, `ListShellSessions`, `GetShellSessionBacklog` | Pod container list, existing shell sessions, backlog replay  | Mixed brokered reads via `dataAccess` and `appStateAccess`   |
| `frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogViewer.tsx`         | `GetContainerLogsScopeContainers`                                           | Container inventory for the current log scope                | Direct Wails read when log scope changes                     |
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

These are app-shell, persisted-state, and app-runtime reads and should migrate through `appStateAccess`.

| File                                                                          | RPC(s)                                        | Why                                                  |
| ----------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------- |
| `frontend/src/modules/kubernetes/config/KubeconfigContext.tsx`                | `GetKubeconfigs`, `GetSelectedKubeconfigs`    | Bootstrap app shell cluster selection state          |
| `frontend/src/core/settings/appPreferences.ts`                                | `GetAppSettings`, `GetThemes`                 | Persisted app configuration                          |
| `frontend/src/ui/settings/Settings.tsx`                                       | `GetThemeInfo`, `GetKubeconfigSearchPaths`    | App settings/config metadata                         |
| `frontend/src/core/contexts/AuthErrorContext.tsx`                             | `GetAllClusterAuthStates`                     | App-shell cluster auth state, not resource data      |
| `frontend/src/core/contexts/ClusterLifecycleContext.tsx`                      | `GetAllClusterLifecycleStates`                | App-shell cluster lifecycle state, not resource data |
| `frontend/src/ui/modals/AboutModal.tsx`                                       | `GetAppInfo`                                  | App metadata                                         |
| `frontend/src/modules/cluster/components/ClusterOverview.tsx`                 | `GetAppInfo`                                  | App metadata reused in a cluster view                |
| `frontend/src/core/persistence/favorites.ts`                                  | `GetFavorites`                                | Persisted app/user state                             |
| `frontend/src/shared/components/tables/persistence/gridTablePersistence.ts`   | `GetGridTablePersistence`                     | Persisted app/user state                             |
| `frontend/src/core/persistence/clusterTabOrder.ts`                            | `GetClusterTabOrder`                          | Persisted app/user state                             |
| `frontend/src/core/contexts/ZoomContext.tsx`                                  | `GetZoomLevel`                                | Persisted app/user state                             |
| `frontend/src/ui/panels/app-logs/AppLogsPanel.tsx`                            | `GetAppLogs`                                  | Application Logs runtime buffer, not cluster resource data    |
| `frontend/src/modules/port-forward/PortForwardsPanel.tsx`                     | `ListPortForwards`                            | Runtime port-forward session inventory               |
| `frontend/src/ui/status/SessionsStatus.tsx`                                   | `ListShellSessions`, `ListPortForwards`       | Runtime shell/port-forward session inventory         |
| `frontend/src/ui/layout/ClusterTabs.tsx`                                      | `GetClusterPortForwardCount`                  | Runtime cluster-scoped session count                 |
| `frontend/src/modules/object-panel/components/ObjectPanel/Shell/ShellTab.tsx` | `ListShellSessions`, `GetShellSessionBacklog` | Runtime shell session lookup and backlog replay      |

### `dataAccess` ownership

These are cluster-derived reads and should migrate through `dataAccess`, even when they currently use direct RPCs.

| File                                                                                  | RPC(s)                   | Why                                                   |
| ------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------- |
| `frontend/src/modules/object-panel/components/ObjectPanel/Yaml/YamlTab.tsx`           | `GetObjectYAMLByGVK`     | Strict-GVK object read for cluster data recovery      |
| `frontend/src/ui/modals/ObjectDiffModal.tsx`                                          | `FindCatalogObjectMatch` | Cluster object resolution                             |
| `frontend/src/shared/utils/eventObjectIdentity.ts`                                    | `FindCatalogObjectByUID` | Cluster object resolution                             |
| `frontend/src/shared/components/modals/RollbackModal.tsx`                             | `GetRevisionHistory`     | Cluster workload revision data                        |
| `frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/index.tsx` | `IsWorkloadHPAManaged`   | Cluster workload capability/state read                |
| `frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogViewer.tsx`         | `GetContainerLogsScopeContainers`  | Container inventory derived from cluster object scope |
| `frontend/src/modules/object-panel/components/ObjectPanel/Shell/ShellTab.tsx`         | `GetPodContainers`       | Container inventory derived from cluster object scope |
| `frontend/src/modules/port-forward/PortForwardModal.tsx`                              | `GetTargetPorts`         | Cluster object/service port discovery                 |

### Internal infrastructure reads

These stay internal to infrastructure/adapters and are not component-level broker targets.

| File                                  | RPC(s)                                         | Why                                                     |
| ------------------------------------- | ---------------------------------------------- | ------------------------------------------------------- |
| `frontend/src/core/refresh/client.ts` | `GetRefreshBaseURL`, `GetSelectionDiagnostics` | Transport/bootstrap plumbing for refresh infrastructure |

## Capability and Permission Read Inventory

Permission reads share the `QueryPermissions` endpoint.

| File                                                                       | API                                        | Data pulled                                           | Current implementation                                   |
| -------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------- | -------------------------------------------------------- |
| `frontend/src/core/capabilities/permissionStore.ts`                        | `window.go.backend.App.QueryPermissions()` | Namespace/cluster permission results plus diagnostics | Brokered through `dataAccess.requestData(...)`           |
| `frontend/src/core/capabilities/hooks.ts`                                  | `window.go.backend.App.QueryPermissions()` | Hook-level permission query batches                   | Brokered through `dataAccess.requestData(...)`           |
| `frontend/src/modules/namespace/contexts/NamespaceContext.tsx`             | `queryNamespacePermissions(...)`           | Permissions for selected namespace / all namespaces   | Frontend helper that eventually calls `QueryPermissions` |
| `frontend/src/modules/namespace/contexts/NsResourcesContext.tsx`           | `queryNamespacePermissions(...)`           | Permissions for active/all namespace resources        | Same helper path                                         |
| `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanel.tsx` | `queryNamespacePermissions(...)`           | Permissions for the panel object’s namespace          | Same helper path                                         |

## Current Fetch Path Summary

The frontend now routes component-level reads through two brokered paths:

1. `dataAccess` for cluster/resource reads
2. `appStateAccess` for app-shell, persisted-state, and runtime operational reads

Underlying transports still vary:

- refresh domains and streaming infrastructure remain behind `dataAccess`
- direct Wails RPC bindings remain behind `appStateAccess` or `dataAccess` adapters
- permission/capability RPCs are now brokered through `dataAccess`

There is no remaining caller-migration or tracked polish work in this slice. Any future changes here would be new feature work, not migration cleanup.

## Read Path Architecture

The current frontend contract is:

1. `appStateAccess` for bootstrap/app-state reads
2. `dataAccess` for cluster/resource reads

These public paths are intentionally separate.

### `appStateAccess`

Use `appStateAccess` for:

- settings, themes, zoom, favorites, and persisted layout state
- kubeconfig inventory/selection state
- app info / version metadata
- app-shell auth/lifecycle hydration
- app-runtime operational/session reads that are not Kubernetes resource data

`appStateAccess` does not participate in cluster refresh policy. It should not know about paused auto-refresh, `background` vs `startup`, or refresh-domain streaming semantics.

### `dataAccess`

Use `dataAccess` for:

- refresh-domain backed cluster/resource data
- cluster-derived direct RPC reads
- permission/capability reads

Every cluster/resource read must go through `dataAccess`, regardless of whether the underlying transport is a refresh domain, a direct Wails RPC, or a permission/capability helper.

### Adapter model

The public broker surface is unified, but the transports behind it still vary.

`dataAccess` adapters:

- `refresh-domain`
- `permission-read`
- `capability-read`
- direct cluster-data RPC readers where needed

`appStateAccess` adapters:

- `rpc-read`
- `persistence-read`

## Cluster-Data Request Model

Cluster/resource reads use explicit request intent instead of boolean “manual” flags.

### Request reasons

- `background`: scheduler-driven upkeep
- `startup`: passive view/tab/panel activation
- `user`: explicit user action such as `Refresh Now`

### Paused-policy matrix

When auto-refresh is disabled:

| Reason       | Allowed? |
| ------------ | -------- |
| `background` | No       |
| `startup`    | No       |
| `user`       | Yes      |

This is the rule that keeps paused cluster-data behavior consistent across the app:

- no passive cluster-data fetches while paused
- no passive loading spinners while paused
- explicit user refresh still works

## Design Rules

### No component-level transport calls

Component code must not call transport helpers directly.

- no component-level `fetchScopedDomain(...)`
- no component-level `triggerManualRefreshForContext(...)`
- no component-level cluster-data Wails RPC reads
- no component-level direct `QueryPermissions`

Components should go through `dataAccess` or `appStateAccess`.

### Scope must stay multi-cluster aware

All request scopes must preserve cluster identity requirements:

- cluster-scoped reads must include `clusterId`
- namespace-scoped reads must include `clusterId` and namespace
- object-scoped reads must include `clusterId`, `group`, `version`, `kind`, and object identity

Foreground views must scope reads to the active cluster only. Multi-cluster scopes are valid only for intentionally aggregated/background/system behavior.

### Diagnostics must stay path-aware

Broker diagnostics should answer:

- what requested the data
- why it was requested
- whether it was blocked while paused
- which adapter serviced it
- whether it hit cache or backend
- whether it is currently loading / blocked / errored

### Loading state comes from broker request state

Cluster-data UI should derive loading behavior from broker request state, not from transport status alone.

Important cluster-data states are:

- `idle`
- `loading`
- `refreshing`
- `ready`
- `error`
- `blocked`

`blocked` is the key paused-startup state for cluster data. `appStateAccess` reads can keep a simpler lifecycle because they do not participate in cluster refresh semantics.

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
