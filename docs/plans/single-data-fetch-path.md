# Frontend Read Path Migration Plan

## Goal

Replace the current mix of:

- `RefreshManager`-driven refreshes
- direct `refreshOrchestrator.fetchScopedDomain(...)` calls
- direct Wails read RPCs
- separate permission/capability query paths

with two explicit frontend read paths:

1. one single path for bootstrap/app-state reads
2. one single path for cluster/resource data reads

This is the difficult but correct fix because it removes the architectural cause of the current confusion around:

- auto-refresh disabled vs initial load
- startup fetch vs user refresh
- inconsistent loading states
- fetches that bypass diagnostics
- multiple definitions of "manual"

Reference inventory:

- See [data-fetch-inventory.md](/Volumes/git/luxury-yacht/app/docs/development/data-fetch-inventory.md)

## Current Status

2026-04-19:

- Phase 1 is complete.
- Phase 2 is in progress.
- Phase 3 refresh-domain conversion is complete for the currently identified direct refresh-domain UI callers.
- Phase 4 manual refresh fan-out conversion is complete for the targeted UI entrypoints.
- Phase 5 bootstrap/app-state conversion is complete for the planned non-deferred readers.
- Phase 6 is partially complete: cluster-derived direct RPC readers now go through `dataAccess`; permission/capability adapters and deferred operational/session readers remain.
- Completed:
  - initial `dataAccess` broker skeleton
  - initial `appStateAccess` broker skeleton
  - centralized paused-policy gate for cluster-data requests
  - brokered manual refresh/context refresh wrapper
  - converted callers:
    - `NamespaceContext`
    - `NsResourcesContext`
    - `useBrowseCatalog`
    - `ClusterOverview`
    - `useMetricsAvailability`
    - `ClusterResourcesContext`
    - `useObjectPanelRefresh`
    - `useObjectPanelPods`
    - `EventsTab`
    - `YamlTab`
    - `ManifestTab`
    - `ValuesTab`
    - `NodeMaintenanceTab`
    - `ObjectDiffModal`
    - `KubeconfigContext`
    - `appPreferences`
    - `ZoomContext`
    - `favorites`
    - `gridTablePersistence`
    - `clusterTabOrder`
    - `AuthErrorContext`
    - `ClusterLifecycleContext`
    - `AboutModal`
    - `Settings`
    - `RollbackModal`
    - `ShellTab` cluster-data reads
    - `LogViewer` cluster-data reads
    - `PortForwardModal` target-port discovery
    - `eventObjectIdentity`
    - workload overview HPA-managed check
  - supporting object-panel callers updated to use request reasons instead of boolean manual flags
- Verified so far:
  - targeted Vitest coverage for broker behavior and converted callers, including bootstrap and cluster-data RPC readers
  - `frontend` typecheck
  - `mage qc:prerelease`
- Remaining in this slice:
  - diagnostics and adapter work from later phases
  - permission/capability broker integration
  - deferred operational/session readers:
    - `SessionsStatus`
    - `PortForwardsPanel`
    - `ClusterTabs`
    - `AppLogsPanel`

## Non-Goals

- Do not force every backend read onto the same transport.
- Do not rewrite the backend refresh subsystem first.
- Do not remove streaming.
- Do not collapse all data into snapshot domains before the frontend contract is unified.

The unification point is the frontend read API, not the transport implementation.

The important refinement is that bootstrap/app-state reads and cluster/resource reads should not share the same public path.

## Current Problem

Today the frontend has multiple independent read paths:

1. `RefreshManager.triggerManualRefreshForContext(...)`
2. direct `refreshOrchestrator.fetchScopedDomain(...)`
3. direct Wails RPC calls like `GetAppInfo()` or `ListShellSessions()`
4. separate permission and capability query systems

Those paths encode request intent differently, or not at all.

The worst current example is `isManual: true`, which is used for:

- actual user-initiated refresh
- component startup load
- view activation load
- tab-open bootstrap fetch

That means the system cannot answer basic policy questions reliably:

- should this run while auto-refresh is paused?
- should this show loading?
- is this a background update or a user action?

## Target Architecture

Introduce two separate broker layers:

1. `appStateAccess`
2. `dataAccess`

### `appStateAccess`

This is the single path for bootstrap/app-state reads such as:

- settings
- themes
- favorites
- saved layout/tab order
- zoom
- kubeconfig inventory/selection reads
- app info/version metadata

This path does **not** participate in cluster refresh policy.

It should not know about:

- auto-refresh paused
- background refresh cadence
- startup vs user refresh

### `dataAccess`

This is the single path for cluster/resource data reads such as:

- namespaces
- cluster overview
- cluster resource views
- namespace resource views
- browse/catalog
- object panel data
- logs/events/yaml/details
- permission/capability reads if they remain cluster-data-adjacent

This path **does** own refresh policy, paused behavior, and loading semantics.

The cluster-data broker should look like:

```ts
dataAccess.request<T>({
  resource,
  scope,
  reason,
  adapter,
  cachePolicy,
  pausedPolicy,
  diagnostics,
});
```

Every cluster/resource read must go through this entrypoint.

### Required cluster-data request fields

| Field | Purpose |
| --- | --- |
| `resource` | Stable logical resource ID, for example `cluster-overview`, `namespaces`, `object-yaml`, `namespace-permissions` |
| `scope` | Multi-cluster-aware request scope; must include `clusterId` where applicable |
| `reason` | Why the read is happening |
| `adapter` | Which transport implementation services the request |
| `cachePolicy` | Whether cached data is acceptable and how long it stays fresh |
| `pausedPolicy` | Whether paused auto-refresh blocks this request |
| `diagnostics` | User-facing label and machine-readable metadata for diagnostics |

### Request reasons

Replace `isManual` with explicit request reasons for the cluster-data path:

- `background`
- `startup`
- `user`

Definitions:

- `background`: scheduler-driven refresh cadence
- `startup`: view activation, tab activation, panel open, or component bootstrap for resource data
- `user`: explicit user intent like `Refresh Now`

### Paused-policy matrix

This plan assumes the following rules:

| Reason | Allowed when auto-refresh is paused? |
| --- | --- |
| `background` | No |
| `startup` | No |
| `user` | Yes |

That means:

- cluster resource data does not load itself while paused
- explicit user refresh still works

Bootstrap/app-state reads are handled by `appStateAccess`, outside this policy.

## Adapter Model

The cluster-data broker does not fetch data itself. It delegates to adapters.

### Adapter types

1. `refresh-domain`
   - Uses `refreshOrchestrator` internally
   - Covers snapshot and streaming-backed domains
   - Examples: `cluster-overview`, `namespace-workloads`, `object-yaml`

2. `permission-read`
   - Uses `QueryPermissions`
   - Covers namespace/cluster permission fetches

3. `capability-read`
   - Uses `EvaluateCapabilities`
   - Covers feature/capability evaluation

The UI should not know which adapter type serviced the request.

### App-state adapters

`appStateAccess` should have its own adapters, initially:

1. `rpc-read`
   - Uses direct Wails RPC bindings
   - Examples: `GetAppSettings`, `GetKubeconfigs`, `GetAppInfo`

2. `persistence-read`
   - Uses existing persistence helpers where appropriate
   - Examples: favorites, grid table persistence, cluster tab order

## Core Design Rules

### 1. No component-level transport calls

After migration:

- no component may call `fetchScopedDomain(...)` directly
- no component may call cluster/resource backend read RPCs directly
- no component may call `QueryPermissions` or `EvaluateCapabilities` directly

The only allowed read entrypoint for cluster/resource data is `dataAccess`.

The only allowed read entrypoint for bootstrap/app-state data is `appStateAccess`.

### 2. Scope must stay multi-cluster aware

All request scopes must preserve current cluster identity requirements:

- cluster-scoped reads must include `clusterId`
- namespace-scoped reads must include `clusterId` and namespace
- object-scoped reads must include `clusterId`, `group`, `version`, `kind`, and object identity

This is non-negotiable.

### 3. Diagnostics must become path-aware and transport-agnostic

Every cluster/resource request should be visible in diagnostics, regardless of whether it was:

- refresh-domain backed
- direct RPC backed
- permission/capability backed

The diagnostics layer should answer:

- what requested the data
- why it was requested
- whether it was allowed while paused
- which adapter serviced it
- whether it hit cache or backend
- whether it is currently loading

### 4. Loading state derives from broker request state

Cluster-data loading UI should stop inferring intent from transport/domain status alone.

Instead, request state should expose:

- `idle`
- `loading`
- `refreshing`
- `ready`
- `error`
- `blocked`

`blocked` is the important new state for paused startup reads.

App-state/bootstrap reads can expose their own simpler lifecycle, for example:

- `idle`
- `loading`
- `ready`
- `error`

They should not use cluster refresh semantics like `refreshing` or `blocked`.

## Proposed Broker Shape

```ts
type DataRequestReason = 'background' | 'startup' | 'user';

type DataAdapterKind =
  | 'refresh-domain'
  | 'permission-read'
  | 'capability-read';

type AppStateAdapterKind = 'rpc-read' | 'persistence-read';

interface DataScope {
  clusterId?: string;
  namespace?: string;
  object?: {
    group: string;
    version: string;
    kind: string;
    name: string;
    namespace?: string;
  };
  rawScope?: string;
}

interface DataRequest<T> {
  resource: string;
  reason: DataRequestReason;
  adapter: DataAdapterKind;
  scope: DataScope;
  cacheKey: string;
  diagnosticsLabel: string;
  allowWhilePaused: boolean;
  read: () => Promise<T>;
}

interface DataRequestResult<T> {
  status: 'idle' | 'loading' | 'refreshing' | 'ready' | 'error' | 'blocked';
  data: T | null;
  error: Error | null;
  blockedReason?: 'auto-refresh-disabled';
  lastUpdated?: number;
}

interface AppStateRequest<T> {
  resource: string;
  adapter: AppStateAdapterKind;
  cacheKey: string;
  diagnosticsLabel: string;
  read: () => Promise<T>;
}

interface AppStateRequestResult<T> {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: T | null;
  error: Error | null;
  lastUpdated?: number;
}
```

### Why `allowWhilePaused` exists

This avoids open-coded paused logic in cluster-data components.

The broker decides:

- `background` -> blocked
- `startup` -> blocked
- `user` -> allowed

## Implementation Decisions

The following decisions are fixed before implementation to avoid re-litigating boundaries during migration.

### 1. `appStateAccess` stays narrow

Phase 1 `appStateAccess` is limited to bootstrap/config/state hydration and app-shell metadata.

Included:

- settings and themes
- favorites
- zoom
- kubeconfig inventory/selection
- cluster tab order
- grid/table persistence
- cluster auth/lifecycle shell state
- `GetAppInfo` when used as app metadata

Excluded from `appStateAccess`:

- cluster-derived object/resource reads
- task-local operational/session reads
- shell/session inventory
- port-forward session inventory
- log buffer reads

### 2. `AuthErrorContext` and `ClusterLifecycleContext` belong to `appStateAccess`

These are cluster-facing, but they are still app-shell state rather than Kubernetes resource data.

Reasons:

- they hydrate the shell before or alongside resource views
- they should not inherit paused cluster-data semantics
- they are not resource snapshots and should not be forced into `dataAccess`

### 3. Cluster-derived RPC reads belong to `dataAccess`

If a direct RPC read is really fetching Kubernetes-derived data for a cluster, namespace, or object scope, it belongs to `dataAccess` even if it is not currently a refresh domain.

Examples:

- revision history
- object resolution helpers
- HPA-managed checks
- object/container discovery tied to a cluster object
- strict-GVK YAML recovery reads

### 4. Operational/session reads are explicitly deferred

Not every non-refresh RPC should be forced into one of these two paths immediately.

Deferred for a later dedicated pass:

- shell session inventory/backlog reads
- port-forward session inventory/count reads
- app log buffer reads

These are operational/runtime session state, not bootstrap/app-state hydration and not cluster resource reads.

### 5. Public API decision

Both brokers should expose:

- an imperative `request(...)` API for adapters and non-React callers
- React hooks layered on top for component usage

Rules:

- components should prefer hooks
- utility modules and orchestrators can use the imperative API
- cache keys must be normalized from resource plus scope/params, not ad hoc strings in leaf callers

### 6. Diagnostics decision

- `dataAccess` gets full diagnostics coverage
- `appStateAccess` gets lightweight diagnostics/tracing only where useful for bootstrap visibility
- deferred operational/session readers do not block Phase 1

### 7. Exact phase-1 slice

Phase 1 implementation should cover only:

- broker types and request reason model
- central paused-policy gate for `dataAccess`
- these first `dataAccess` callers:
  - `NamespaceContext`
  - `ClusterOverview`
  - `ClusterResourcesContext`
  - `useObjectPanelRefresh`
- tests that prove:
  - paused blocks `startup`
  - paused allows `user`
  - blocked startup reads surface a non-loading state
  - multi-cluster scope is preserved

## Relationship To Existing Systems

### RefreshManager

Keep it, but narrow its responsibility:

- scheduler only
- emits requests into the broker using `reason: background`
- no UI or component should call it directly except through broker-integrated manual refresh APIs

### refreshOrchestrator

Keep it initially, but demote it to an internal adapter backend.

It should stop being a thing that random components import.

Short-term role:

- transport adapter for refresh domains
- stream lifecycle owner
- scoped snapshot fetch executor

Long-term role:

- likely split into:
  - domain transport adapter
  - stream coordinator
  - refresh diagnostics backend

### appStateAccess

Keep this separate from cluster refresh concerns.

Short-term role:

- app bootstrap/config/state hydration only
- direct RPC and persistence adapter host
- common caching and diagnostics for bootstrap reads where useful

Examples:

- app settings
- themes
- favorites
- kubeconfig list/selection reads
- zoom
- app info

Non-goal for the first pass:

- do not fold every miscellaneous one-off RPC into `appStateAccess` just because it is not a refresh domain
- shell sessions, log container discovery, revision history, and similar task-local readers can stay separate until a later pass decides whether they belong under `dataAccess` or another dedicated RPC path

### Permission and capability systems

Do not rewrite their backend behavior first.

Wrap them with `dataAccess` request metadata and paused-policy handling.

## Migration Phases

## Phase 0: Inventory ✅

- [x] Document all current frontend read paths
- [x] Identify refresh-domain registry
- [x] Identify direct Wails read paths
- [x] Identify permission/capability read paths

Output:

- [x] [data-fetch-inventory.md](/Volumes/git/luxury-yacht/app/docs/development/data-fetch-inventory.md)

## Phase 1: Introduce Request Reason Model

- [x] Add `DataRequestReason` type
- [x] Add paused-policy enforcement in one place
- [x] Replace internal use of `isManual` at the broker boundary
- [x] Preserve transport internals temporarily, but require reason mapping before execution

Deliverable:

- cluster-data broker can distinguish `background`, `startup`, and `user`

## Phase 2: Add Data Access Broker

- [x] Create `frontend/src/core/data-access/`
- [x] Add broker request/response types
- [ ] Add diagnostics events/state for all requests
- [ ] Add adapter registration mechanism
- [x] Add broker-level paused-policy enforcement
- [ ] Add broker-level cache-key semantics

Deliverable:

- a single request API exists, even if only a few paths use it initially

## Phase 2.5: Add App-State Access Broker

- [ ] Create `frontend/src/core/app-state-access/`
- [ ] Add bootstrap/app-state request/response types
- [ ] Add adapter registration for direct RPC-backed app-state reads
- [ ] Add diagnostics metadata for app-state reads where useful

Deliverable:

- a single app-state read API exists for bootstrap/config/state hydration

## Phase 3: Convert Refresh Domain Callers

This is the highest-priority migration because it fixes the current refresh confusion.

### First conversion batch

- [x] `frontend/src/modules/namespace/contexts/NamespaceContext.tsx`
- [x] `frontend/src/modules/namespace/contexts/NsResourcesContext.tsx`
- [x] `frontend/src/modules/browse/hooks/useBrowseCatalog.ts`
- [x] `frontend/src/modules/cluster/components/ClusterOverview.tsx`
- [x] `frontend/src/core/refresh/hooks/useMetricsAvailability.ts`
- [x] `frontend/src/modules/cluster/contexts/ClusterResourcesContext.tsx`
- [x] `frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelRefresh.ts`
- [x] `frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelPods.ts`
- [x] `frontend/src/modules/object-panel/components/ObjectPanel/Events/EventsTab.tsx`
- [x] `frontend/src/modules/object-panel/components/ObjectPanel/Yaml/YamlTab.tsx`
- [x] `frontend/src/modules/object-panel/components/ObjectPanel/Helm/ManifestTab.tsx`
- [x] `frontend/src/modules/object-panel/components/ObjectPanel/Helm/ValuesTab.tsx`
- [x] `frontend/src/modules/object-panel/components/ObjectPanel/Maintenance/NodeMaintenanceTab.tsx`
- [x] `frontend/src/ui/modals/ObjectDiffModal.tsx`

Rules for this phase:

- each direct call to `fetchScopedDomain(...)` must become a broker request
- each call site must declare `reason`
- component code must stop encoding pause policy

Deliverable:

- no UI component directly calls `fetchScopedDomain(...)`
- current progress:
  - all currently identified direct refresh-domain UI readers in this slice now go through `dataAccess`
  - supporting object-panel action callers now pass explicit request reasons

## Phase 4: Convert Manual Refresh Fan-Out

- [x] Wrap `triggerManualRefreshForContext(...)` with the broker
- [x] Route global refresh shortcut through broker `reason: user`
- [x] Route view-switch startup fetch through broker `reason: startup`
- [x] Stop using `triggerManualRefreshForContext(...)` as a generic escape hatch

Files to convert first:

- [x] `frontend/src/App.tsx`
- [x] `frontend/src/core/contexts/ViewStateContext.tsx`
- [x] `frontend/src/ui/command-palette/CommandPaletteCommands.tsx`
- [x] `frontend/src/ui/status/ConnectivityStatus.tsx`

Deliverable:

- refresh reasons are explicit everywhere

## Phase 5: Convert Bootstrap/App-State Reads

- [x] Add `appStateAccess` adapters for bootstrap/config reads
- [x] Convert app bootstrap/state readers to `appStateAccess`
- [ ] Add diagnostics coverage where appropriate

Recommended order:

1. persisted app shell state
   - [x] `KubeconfigContext`
   - [x] `appPreferences`
   - [x] `ZoomContext`
   - [x] `favorites`
   - [x] `gridTablePersistence`
   - [x] `clusterTabOrder`
2. app shell bootstrap providers
   - [x] `AuthErrorContext`
   - [x] `ClusterLifecycleContext`
3. app metadata/settings surfaces
   - [x] `AboutModal`
   - [x] `Settings`

Deliverable:

- bootstrap/config/state hydration no longer bypasses a shared app-state path

## Phase 6: Convert Cluster-Data-Adjacent RPC Reads and Permission/Capability Reads

- [x] Add `dataAccess` adapters for cluster-data-adjacent RPC reads where the data is Kubernetes-derived or cluster-scoped
- [ ] Add `permission-read` adapter
- [ ] Add `capability-read` adapter
- [ ] Wrap `queryNamespacePermissions(...)`
- [ ] Wrap `EvaluateCapabilities(...)`
- [ ] Decide destination for remaining one-off task-local RPC readers
- [ ] Add diagnostics entries for these request types

Likely `dataAccess` readers in this phase:

- [x] `RollbackModal`
- [x] `ShellTab`
- [x] `LogViewer`
- [x] `PortForwardModal`
- [x] `ObjectDiffModal`
- [x] `eventObjectIdentity.ts`
- [x] workload overview HPA-managed check

Deferred from this phase:

- [ ] `SessionsStatus`
- [ ] `PortForwardsPanel`
- [ ] `ClusterTabs`
- [ ] `AppLogsPanel`

Special case:

- [ ] `ShellTab`
  `GetPodContainers` belongs to `dataAccess`; session/backlog reads stay deferred until an operational/session path is designed

Deliverable:

- permission/capability reads participate in the same request policy and diagnostics system
- cluster-derived direct RPC reads have a home in `dataAccess`
- operational/session RPC reads remain explicitly out of scope instead of being misclassified

## Phase 7: Deprecate Old Entrypoints

- [ ] Mark direct `fetchScopedDomain(...)` UI usage as deprecated
- [ ] Add lint enforcement or import restrictions
- [ ] Mark direct bootstrap/config/state Wails RPC imports as deprecated outside `appStateAccess`
- [ ] Mark direct cluster-data Wails RPC imports as deprecated outside `dataAccess` adapters
- [ ] Restrict direct refresh transport usage to adapters only

Deliverable:

- the architecture cannot silently regress

## Acceptance Criteria

The migration is complete when all of the following are true:

- every cluster-data request declares a reason
- auto-refresh paused behavior is enforced centrally
- startup fetches are blocked consistently while paused
- user refreshes are allowed consistently while paused
- all cluster-data requests appear in diagnostics
- no component directly imports `fetchScopedDomain(...)` for reads
- permission and capability reads use the same request/diagnostic model

Refined interpretation:

- every bootstrap/app-state read goes through `appStateAccess`
- every cluster/resource read goes through `dataAccess`
- bootstrap/app-state reads do not depend on cluster paused-policy semantics
- no bootstrap/config/state surface directly imports read-only Wails RPC bindings

## Risks

### Risk: partial migration leaves two architectures alive

Mitigation:

- add deprecation/lint guards before the final phase is complete

### Risk: refresh-domain adapters leak transport semantics back into UI

Mitigation:

- do not expose `isManual` to callers
- only expose `reason`

### Risk: over-normalizing app bootstrap reads with resource reads

Mitigation:

- keep `appStateAccess` and `dataAccess` as separate public paths
- keep adapters transport-specific internally

### Risk: `appStateAccess` grows into a junk drawer for unrelated RPCs

Mitigation:

- scope `appStateAccess` to bootstrap/config/state hydration first
- require an explicit classification decision before moving task-local RPC readers into either `appStateAccess` or `dataAccess`

### Risk: multi-cluster identity regressions

Mitigation:

- require `clusterId` in broker scope for all cluster-bound reads
- require object reads to carry full GVK identity

## Recommended First Implementation Slice

If work starts now, the first real code slice should be:

1. add broker types and `reason`
2. migrate:
   - `NamespaceContext`
   - `ClusterOverview`
   - `ClusterResourcesContext`
   - `useObjectPanelRefresh`
3. add diagnostics for broker requests
4. block `startup` requests centrally when paused

Why this slice first:

- it fixes the confusing paused/startup behavior quickly
- it hits both namespace and cluster views
- it exercises system, cluster, and object-scoped refresh domains
- it avoids starting with lower-value app-shell RPC reads

## Summary

The correct fix is not another paused-state patch.

The correct fix is:

- one single path for bootstrap/app-state reads
- one single path for cluster/resource reads
- one explicit reason model for cluster data only
- one paused-policy gate for cluster data only
- diagnostics that can cover both paths without forcing them into the same semantics
- adapters underneath for refresh domains, app-state RPC reads/persistence, and permissions/capabilities

That is the only approach that will make the system understandable again without continuing to patch behavior piecemeal.
