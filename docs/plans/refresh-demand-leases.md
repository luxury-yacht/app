# Refresh Demand Leases

Temporary plan from the 2026-10-19 app-wide design review, finding #1. It
covers the frontend refresh core, its consumers, and the frontend-only fields of
the refresh domain contract.

- **Precondition:** met. PR 397 (typed scope codec, typed object-details
  payload) is on `main` as `ea610573`.
- **Status:** approved by John on 2026-10-19, with decisions 1-10 and both
  reviews' fixes as recorded. Nothing is implemented yet; work starts at
  Phase 0.
  - John decided [design questions](#decisions) 1-9 on 2026-10-19.
    Question 1 added [Phase 4](#phase-4-object-details-change-signal).
  - The same day's plan review added four fixes: failed-read retries,
    Overview's activation read, skipping container logs in manual refresh,
    and one pause rule. John decided the pause rule as decision 10.
  - A second review the same day added two more requirements: a typed request
    intent that survives deferral and replay (Phase 2), and no details signal
    on resync echoes (Phase 4).
- File references are relative to `frontend/src/` unless they start with
  `backend/`, `docs/`, or `.agents/`. Line numbers are from `ea610573`.

## Problem

Five mechanisms with separate identities decide whether a
`(clusterId, domain, scope)` fetches, polls, or streams:

1. **Timers keyed by name.** `RefreshManager` keeps one interval per refresher
   name (`core/refresh/RefreshManager.ts:147`, `:599`). The orchestrator
   registers one refresher per domain from the contract's
   `frontend.refresherName` (`core/refresh/orchestrator.ts:1191-1207`). The
   refresher is enabled while any scope of the domain is enabled in any cluster
   (`orchestrator.ts:462-475`). Each tick fetches every enabled scope of that
   domain in every cluster (`orchestrator.ts:305-313`, `:446-456`).
2. **Per-scope records with two entry APIs.** `ClusterRefreshRuntime` owns
   activation, fetch, readiness, permission, and stream state per scope
   (`core/refresh/refreshRuntime.ts:449-458`). A scope becomes active through
   reference-counted leases (`orchestrator.ts:582-644`) or through a direct
   enable that is not counted (`orchestrator.ts:537-577`, wrapped by
   `setRefreshDomainEnabled`, `core/data-access/dataAccess.ts:132-148`).
3. **A view gate over copied navigation state.** Code in four modules pushes
   navigation into `RefreshContext` (`RefreshManager.ts:24-42`) through 12
   `updateContext` calls. `shouldStreamScope` refuses a stream when the copied
   view does not match per-domain view tables (`orchestrator.ts:804`,
   `core/refresh/resourceStreamViews.ts:24-86`).

   Leaving the namespace view does two things to every namespace-category
   domain (`orchestrator.ts:333-338`, `:1023-1038`):
   - it disables the scopes that no lease holds;
   - it clears the stored data of every scope in every cluster, leased or not
     (`core/refresh/store.ts:220-225`).
4. **Timers registered by components.**
   - The object panel registers a refresher per panel at
     `pod ? 2000 : 5000` ms (`useObjectPanelRefresh.ts:137-142`). It sits next
     to the panel's own enable of the same scope (`:117-123`).
   - The Events tab registers a 3000 ms refresher (`EventsTab.tsx:183-195`).
     The scope also has a doorbell (`:149`) and the domain's own 10 s
     refresher.
   - `BackgroundClusterRefresher` polls inactive clusters every 15 s through
     maps from refresher names to domains
     (`core/refresh/backgroundClusterRefresher.ts:21`, `:60-93`).
5. **Signal refetch owned by consumers.** Each snapshot reader must mount
   `useStreamSignalRefetch` (8 files), which dedupes through a module-level map
   (`core/refresh/hooks/useStreamSignalRefetch.ts:103-131`). A guard test exists
   because readers kept missing it
   (`core/refresh/streamConsumerDrift.test.ts:1-20`).

Streams also start as a side effect of the polling path
(`orchestrator.ts:1236-1238`, `:1279-1281`).

Consequences, read from the code (not observed at runtime this turn):

- **The view gate ignores the scope's cluster.** It reads one global view
  (`resourceStreamViews.ts:65-86`).
- **Native panel windows never publish context.** `PanelWindowApp.tsx:313-331`
  mounts neither `ViewStateProvider` nor `KubeconfigProvider`, and
  `FixedClusterProvider` does not call `updateRefreshContext`. Their
  orchestrator keeps the constructor default (`orchestrator.ts:143-146`). Panel
  metrics leases on `nodes`, namespace `pods`, and `namespace-workloads`
  (`core/resource-metrics/scope.ts:17-44`) therefore poll in a native window.
  In the main window, the same leases stream or poll depending on the current
  view.
- **Direct enables: the last write wins.**
  - `ClusterOverview.tsx:251` and `useMetricsAvailability.ts:44` both enable
    the same `cluster-overview` scope (`ClusterOverview.tsx:110-113`,
    `useMetricsAvailability.ts:26-29`).
  - `yamlTransaction.ts:555` and `useObjectDiffYaml.ts:65` both enable
    `object-yaml`. The diff modal disables and resets its scope on close
    (`useObjectDiffYaml.ts:72-75`). That could hit a YAML tab showing the same
    object [unverified: the two scopes must match at runtime].
- **Global manual refresh crosses clusters.** It fetches the active view's
  domain in every cluster with an enabled scope, not just the foreground
  cluster (`orchestrator.ts:343-356` → `RefreshManager.ts:465-471` →
  `orchestrator.ts:446-456`).
- **Two fetch backoffs.** RefreshManager's cooldown doubles up to 60 s
  (`RefreshManager.ts:894-931`). The runtime's reconciliation backoff also caps
  at 60 s (`refreshRuntime.ts:717-726`).
- **Past bugs from this split:**
  - Refresher-name collisions between panels. Names now include `panelId`
    (`modules/object-panel/components/ObjectPanel/constants.ts:68-95`).
  - The frozen Pods tab. Focused pods scopes now bypass the gate
    (`resourceStreamViews.ts:11-20`).

## Assumption: hidden views unmount

Verified this turn. The direction depends on it: once the gate is gone, a lease
held by a mounted but hidden consumer becomes stream demand.

| Surface | When hidden | Evidence |
| --- | --- | --- |
| Inactive cluster tab | Unmounted. One route tree for the selected cluster; panels come from that cluster's slice. | `ui/layout/AppLayout.tsx:296-323`; `ObjectPanelStateContext.tsx:64-70`; `DockablePanelProvider.tsx:169` keys groups by cluster |
| View change within a cluster | Unmounted. Each view and tab is a distinct component. | `AppLayout.tsx:151-191`, `ClusterResourcesViews.tsx:66-105`, `NsResourcesViews.tsx:43-55` |
| Transient object-panel tabs (Details, Events, Pods, Map, Helm, Shell, Jobs) | Unmounted on tab change. | `ObjectPanelContent.tsx:436` (`key={activeTab}`) |
| Retained Logs, Metrics, YAML tabs | **Mounted and hidden** after first view. | `ObjectPanelContent.tsx:99-115` (`useShownOnce`, `RetainedTabFrame`) |
| Inactive panel in a dock group | **Mounted and hidden** (portal into a `hidden` host). | `ui/dockable/DockablePanelGroup.tsx:557-567`, `DockablePanel.tsx:160-162` |
| Native panel window | Mounted for its fixed cluster, whatever the main window shows. Separate React root and orchestrator. | `PanelWindowApp.tsx:274-287`, `:313-331` |
| Hidden document | Mounted. RefreshManager paused; stream managers suspended. | `core/refresh/contexts/RefreshManagerContext.tsx:39-55`, `resourceStreamManager.ts:146-147` |

Mounted, hidden consumers already gate their leases on activity props, not on
the view gate:

- **Dock tabs:** `isActiveTab` gates the details lease and every sub-tab
  (`ObjectPanel.tsx:100-102`, `:176-185`; `ObjectPanelContent.tsx:429`).
- **Retained Logs and YAML:** gated on `isPanelOpen && isVisible`
  (`ObjectPanelContent.tsx:188`, `:476`).
- **Exception, by design:** `usePanelMetricsCollector` holds its metrics lease
  for the panel's whole life, even behind other dock tabs
  (`ObjectPanel.tsx:123-126`).
- **Retained Metrics** reads panel samples while its panel is the active dock
  tab (`ObjectPanelContent.tsx:460`). That read is an RPC outside refresh
  domains (`core/data-access/readers.ts:79`), so this plan does not touch it.

**Conclusion:** the assumption holds for views and cluster tabs. Mount lifetime
already means "this consumer wants the data now". The view gate adds one
effect: it turns the metrics collector's stream into polling in most views
([question 5](#decisions)).

## Target model

- **One demand signal.**
  - A lease on `(clusterId, domain, RefreshScope)` with
    `demand: 'query' | 'snapshot'` is the only way a scope becomes active.
    `RefreshDemand` already exists (`refreshRuntime.ts:64`).
  - Scopes are built with the codec (`core/refresh/scopeSelector.ts:42-46`,
    `:151`).
  - No direct enables, no navigation context, no refresher names.
- **The lease record owns its work.**
  - The scope's `ScopedRefreshState` gains a polling sub-state.
  - Activation, stream connection, backoff, readiness deferral, and permission
    stay where they are.
  - The orchestrator still runs network, timer, and store effects
    (`docs/architecture/refresh-system.md`, "Frontend runtime state").
- **Streams follow edges, not side effects.**
  - Start on:
    - the first lease;
    - cluster serviceable, auth recovered, or scope/permission rebuilt;
    - auto-refresh back on, or a stream block cleared;
    - a backed-off retry after a failed start.
  - Stop on: the last release, auth failure, foreground activation,
    auto-refresh off, or a block.
  - Fetch paths never start streams.
- **Cadence comes from the contract.**
  - A leased scope polls at its domain's generated `frontend.timing.interval`
    (`core/refresh/domainRegistry.ts:161-177`) in three cases:
    - the domain has no stream;
    - its stream is not healthy;
    - the domain keeps polling while streaming
      (`streaming/resourceStreamDomains.ts:99-100`).
  - Snapshotless streams (`container-logs`) never poll
    (`core/refresh/refreshRegistration.ts:11-14`).
  - Leases with only query demand advance the query-reconcile identity instead
    of fetching. This is unchanged (`orchestrator.ts:1220-1255`).
  - **Failed reads retry on their own schedule.** A scope with pending
    reconciliation retries at its `retryAt` whatever its stream's health.
    - Today the retry counts as a signal, so the healthy-stream skip cannot
      swallow it (`orchestrator.ts:1288`). The domain refresher's next tick
      fires it (`refreshRuntime.ts:708-726`).
    - Here the record schedules the retry directly, apart from fallback
      polling. Retries stop on success, on a settled permission denial, or on
      release.
  - **No read on acquisition.** The scheduler never reads when a lease is
    acquired. See [Activation reads](#activation-reads).
  - The orchestrator owns one timer, armed for the earliest due record.
- **Pause is an input, not a manager.**
  - Auto-refresh off or a hidden document pauses passive polls, retries, and
    streams, as today.
  - One predicate decides what runs while auto-refresh is off: the broker's
    rule (`isDataAccessBlocked`, `dataAccess.ts:25-34`). Only `foreground`
    and `user` run. Scheduler polls, retries, and (Phase 9) signal refetches
    are passive, so they wait.
  - So `stream-signal` reads do not run while paused. That matches the broker
    and the hook (`useStreamSignalRefetch.ts:10-12`), but contradicts the
    intent table in `data-freshness.md:42` ([decision 10](#decisions)).
  - A hidden document pauses only the scheduler, as it pauses RefreshManager
    today (`RefreshManagerContext.tsx:42-44`). Broker reads ignore it.
- **Manual refresh names its cluster.**
  `requestContextRefresh({ reason: 'user', clusterId })` refreshes that
  cluster's leased scopes ([question 3](#decisions)).
- **One outside input.** The orchestrator's only outside input is the set of
  connected clusters, used for runtime pruning (`orchestrator.ts:329-331`,
  `:1136-1162`).

### Activation reads

A scope that becomes visible gets its first read, or its retained-data
reconcile, from one of two sources:

- **Its stream starts.**
  - Without data, the stream's acknowledgement triggers one initial read
    (`orchestrator.ts:952-973`).
  - With retained data, the subscription's first RESET triggers one
    `stream-signal` reconcile (`data-freshness.md`, "Signals and source
    clocks").
- **The consumer's `fetchOnEnable` intent**, which stays consumer-owned.

RefreshManager also had two sources that this plan deletes:

- the foreground targets on context changes (`RefreshManager.ts:620-647`);
- a one-time immediate run per refresher name (`RefreshManager.ts:586-588`).

An audit of every snapshot-demand consumer found exactly one that relied on
them:

- **ClusterOverview.** It enables `cluster-overview` without requesting a read
  (`ClusterOverview.tsx:247-256`). While paused, no stream runs, and only the
  foreground target for a selected-cluster change in Overview reconciled it
  (`RefreshManager.ts:642-644`). Phase 1 gives it
  `fetchOnEnable: 'foreground'`. That read runs while paused, with retained
  data or none.

Every other snapshot lease is covered:

- `useClusterMetricsAvailability` requests `startup` outside Overview
  (`useMetricsAvailability.ts:46-54`).
- The Global views request `startup` and `foreground`
  (`GlobalViewClusters.tsx:72-80`, `GlobalViewNamespaces.tsx:40-50`).
- `useResourceMetrics` requests `startup` (`useResourceMetrics.ts:71-77`).
- NamespaceContext requests its own reads
  (`NamespaceContext.tsx:519-548`, `:564-575`).
- The object-panel tabs, modals, and maintenance views request `startup` or
  `user`.
- The Sidebar attention lease and `useAvailableResourceViews` rely on their
  streams. Catalog tails stream (`scopeSelector.ts:87-88`). While paused,
  neither got a read before this plan either.

Today, `startup` consumers with retained data do not reconcile when they
become visible while paused, because the broker blocks `startup`. That is
unchanged here. It conflicts with `data-freshness.md` rule 2, so it is a
candidate follow-up.

**Deleted:**

- Modules:
  - `RefreshManager.ts`, `refresherRuntimeState.ts`, `refresherTypes.ts`,
    `refresherConfig.ts`.
  - `useRefreshWatcher.ts`.
  - The view tables in `resourceStreamViews.ts`.
- APIs and types:
  - `RefreshContext` and `updateContext`.
  - `setScopedDomainEnabled`, `setDomainEnabled`, `setRefreshDomainEnabled`.
- Names and maps:
  - Per-panel refresher names.
  - The view registry's `refresher` fields.
- `BackgroundClusterRefresher` and the **Refresh background clusters** setting
  ([question 4](#decisions)).
- Contract fields: `frontend.refresherName`, `frontend.scheduled`, and
  `frontend.timing.cooldown` ([question 7](#decisions)). `interval` and
  `timeout` stay.

## Behavior changes

Everything else should behave as it does today. These changes are
deliberate:

- **Panel metrics leases stream instead of polling every 5 s.** This applies
  to native panel windows and to the main window in any view. Request rate is
  about the same while metrics-server is present
  ([question 5](#decisions)).
- **Namespace-domain data survives leaving the namespace view.** Returning to
  the view repaints retained rows, per `data-freshness.md` rule 1.
- **Global manual refresh** covers the foreground cluster's leased scopes and
  no other cluster's. [Question 3](#decisions).
- **Object details refresh on change.** Open panels refetch right after the
  backend evicts their cached details. Every kind keeps a 10 s backstop poll,
  replacing today's 2 s (Pods) and 5 s (others) timers
  ([question 1](#decisions)).
- **The Events tab drops its 3 s timer.** The contract's 3 s fallback keeps
  the same speed while the stream is down ([question 2](#decisions)).
- **ConnectivityStatus** shows "refreshing" only for manual refresh
  ([question 8](#decisions)).
- **The "Refresh background clusters" setting is removed.** Inactive cluster
  tabs no longer poll every 15 s ([question 4](#decisions)).

## Non-goals

- **Backend behavior, except Phase 4.** Phase 4 adds the details change
  signal. Otherwise only the generator's frontend fields change
  (`backend/internal/genrefreshcontracts/domain_contract.go:50`, `:56`). No
  backend code outside the generator reads them: `rg '\.RefresherName'`
  matches only `backend/refresh/domain/policy_generated.go:89`.
- **KubeconfigContext's selection queue** (`KubeconfigContext.tsx:193-209`).
  - It is the documented owner of selection transitions
    (`docs/architecture/multi-cluster.md:18-21`).
  - The backend serializes the commands it sends
    (`backend/workspace_state.go:263`).
  - Its only refresh coupling, `updateRefreshContext`
    (`KubeconfigContext.tsx:275-300`), shrinks here to the connected-cluster
    set.
  - Simplifying the queue needs its own plan.
- **Other refresh machinery:**
  - stream protocol and stream managers;
  - snapshot caches;
  - the readiness and activation boundary
    (`core/cluster-workspace/clusterWorkspaceStore.ts:634-692`);
  - permission epochs;
  - metrics demand, which is already derived from leases
    (`orchestrator.ts:1695-1703`).
- **Query page ownership.** Tables keep issuing their own page reads with
  `user` intent (`useTypedResourceQuery.ts:577`, `:718`).
- **Consumer `fetchOnEnable` intents.**
- **Timers outside refresh domains:**
  - node logs (`NodeLogsTab.tsx:406`);
  - permission re-queries (`core/capabilities/permissionStore.ts:1136`);
  - diagnostics polling (`useDiagnosticsPolling.ts:113`);
  - the palette's direct catalog `fetchSnapshot`
    (`ui/command-palette/usePaletteCatalogSearch.ts:59`).
- **UI or layout changes.**

## Inventory

### RefreshManager (timers keyed by name)

| Caller | Use |
| --- | --- |
| `orchestrator.ts:291-322`, `:462-475`, `:1191-1218` | Registers, subscribes, enables, and disables one refresher per domain |
| `orchestrator.ts:1032` | Disables on leaving the namespace context |
| `orchestrator.ts:324-327`, `:343-345` | Forwards context; manual refresh for context |
| `RefreshManager.ts:378-401`, `:620-671` | Foreground and manual targets from view → refresher maps |
| `useObjectPanelRefresh.ts:125-162` | Details refresher per panel, 2000/5000 ms |
| `EventsTab.tsx:177-206` | Events refresher per panel, 3000 ms |
| `core/refresh/hooks/useAutoRefresh.ts:18-60`, `RefreshManagerContext.tsx:38-56` | Global pause and resume; visibility |
| `core/refresh/hooks/useRefreshWatcher.ts:39-121` | Subscriber hook (the two panel users above) |
| `core/refresh/components/DiagnosticsPanel.tsx:519-536`, `:935-978`, `:1341-1343` | Polling state and interval by refresher name |
| `ui/status/ConnectivityStatus.tsx:36-37`, `useAutoRefreshLoadingState.ts:16-27` | Listeners for `refresh:start` and `refresh:complete` |
| `domainRegistry.ts:187-189`, `:205-207`; `refresherConfig.ts`; `refresherTypes.ts`; `core/navigation/viewRegistry.ts` `refresher` fields | Name tables |
| Contract `frontend.refresherName`/`scheduled` → `types.generated.ts`, `policy_generated.go` | Generated names |

### RefreshContext (copied navigation)

- **Writers (12):**
  - `core/contexts/ViewStateContext.tsx:232`, `242`, `256`, `275`, `288`,
    `307`, `337`, `446`;
  - `KubeconfigContext.tsx:279`;
  - `NamespaceContext.tsx:655`;
  - `NsResourcesContext.tsx:57`, `63`.
- **Readers:**
  - `RefreshManager.ts:101-126`, `391`, `642-667`;
  - `orchestrator.ts:329-330`, `705`, `716`, `1020`, `1045-1056`, `1181-1187`;
  - `resourceStreamViews.ts:31-35`, `79`, `83`.
- **Unused:** `selectedClusterName`, `backgroundRefreshEnabled`, and
  `objectPanel` have no readers. `getSelectedClusterId`, `getClusterIds`, and
  `getAllConnectedClusterIds` (`orchestrator.ts:703-720`) have no production
  callers.

### View gate

- **Tables** (`resourceStreamViews.ts:24-63`):
  - pods: the workloads and pods views, plus the nodes view on all namespaces;
  - 8 namespace domains;
  - 5 cluster domains.
- **Applied** through `shouldStreamScope` (`orchestrator.ts:780-811`) at
  `orchestrator.ts:485`, `:1236`, `:1268`, and `:1978`.
- **Related:** `disableNamespaceDomains` (`orchestrator.ts:1019-1038`) and the
  pods special case for manual refresh (`:1040-1067`).
- **Kept:** `isResourceStreamDomain` (`resourceStreamViews.ts:8-9`). It moves
  next to `RESOURCE_STREAM_DOMAINS`.

### Direct enables (not counted)

| Caller | Domain |
| --- | --- |
| `useMetricsAvailability.ts:44`, `ClusterOverview.tsx:251` | `cluster-overview` (same scope) |
| `NamespaceContext.tsx:489`, `504`, `580`, `690`, `701`, `722`; `resetDomain` at `510`, `682`, `693` | `namespaces`, every open cluster |
| `yamlTransaction.ts:555`, `565`; `useObjectDiffYaml.ts:65`, `73` | `object-yaml` |
| `ui/modals/ObjectDiffModal.tsx:465`, `474` | `catalog-diff` |
| `DrainNodeModal.tsx:106`, `113`; `useNodeMaintenanceActions.tsx:114`, `123` | `object-maintenance` |
| `useObjectPanelScopedDomainLifecycle.ts:74-165`, used by `useObjectPanelRefresh.ts:117`, `EventsTab.tsx:136`, `ObjectPanelContent.tsx:429`, `ObjectPanel.tsx:219` | `object-details`, `object-events`, `object-yaml`, Helm, `object-map`, `container-logs` |
| `useContainerLogsStream.ts:21-26`; `LogViewer.tsx:705` | `container-logs`, plus explicit stop and restart |
| `core/data-access/useRefreshDomainHandle.ts:55-68` (`setEnabled`) | Any (no production callers) |
| Orchestrator internals: `setDomainEnabled` (`:358-365`); kubeconfig-changing (`:1960-1965`) | All |

### Timers registered by components

- `useObjectPanelRefresh.ts:137-142`.
- `EventsTab.tsx:186-191`.
- `backgroundClusterRefresher.ts:116`, started from
  `useBackgroundClusterRefresh.ts:38-50`, mounted at
  `core/contexts/KubernetesProvider.tsx:31`.

### Signal refetch owned by consumers

`useStreamSignalRefetch` call sites:

- `GlobalViewClusters.tsx:239`
- `GlobalViewNamespaces.tsx:87`
- `ClusterOverview.tsx:125`
- `useAvailableResourceViews.ts:19`
- `useResourceMetrics.ts:86`
- `NamespaceContext.tsx:295-296` (two calls)
- `ui/layout/Sidebar.tsx:872`
- `EventsTab.tsx:149`

`streamConsumerDrift.test.ts` enforces the hook.

### Already lease-based

- **Query tables:** `useQueryBackedResourceGridTable.ts:258`, used by 20 views
  and `PodsTab.tsx:241`.
- **Hooks and views:**
  - `useBrowseCatalog.ts:394-405`
  - `useAvailableResourceViews.ts:13`
  - `Sidebar.tsx:866`
  - `useIdentityDetails.ts:13`
  - `MapTab.tsx:45`, `NsViewMap.tsx:50`
  - Helm `ValuesTab.tsx:55` and `ManifestTab.tsx:23`
  - `useResourceMetrics.ts:71`
  - `GlobalViewClusters.tsx:72`, `GlobalViewNamespaces.tsx:42`
  - `NamespaceContext.tsx:554`
- **One-shot reads:** `requestRefreshDomainState` (`dataAccess.ts:98-130`).

### Tests that encode the old model

- References by API:
  - `refreshManager`: 21 files.
  - `updateContext`: 17 files.
  - `setScopedDomainEnabled`/`setRefreshDomainEnabled`: 26 files.
  - `useRefreshWatcher`: 5 files.
- Removed with their modules: `resourceStreamViews.test.ts`,
  `RefreshManager.test.ts` (1487 lines), and `refresherRuntimeState.test.ts`.
- `orchestrator.streamingFlap.test.ts:30-52` mocks RefreshManager and the view
  gate. The new harness must not.

### Docs that describe the old model

- `docs/architecture/data-freshness.md:47`
- `docs/architecture/refresh-system.md:95`, `:147-156`
- `.agents/skills/refresh-subsystem/references/domain-wiring.md:62-69`
- `docs/frontend/biome.md:46`

## Cross-layer contract

1. **Producer and consumers.** Lease records in `ClusterRefreshRuntime`
   produce demand. Consumers:
   - every hook in the inventory;
   - Diagnostics and ConnectivityStatus;
   - metrics demand;
   - the stream managers;
   - the generated contract.

   Phase 4 adds a backend producer: the details change notifier. Its
   consumers are the resource-stream manager's `object-details` subscribers
   and, through them, open Details tabs.
2. **Ordering and readiness.** Unchanged.
   - Fetches and stream starts stay behind `isScopeClusterServiceable`
     (`orchestrator.ts:176-185`) and foreground activation (`:207-223`).
   - Deferred work is dropped when its lease is gone (`:232-236`).
   - Stream starts keep the flap contract (`refresh-system.md`, "Streaming
     start lifecycle").
3. **Circular dependencies.** This work removes two dependencies:
   - `core/refresh` → `core/navigation/viewRegistry`, through
     `refresherTypes.ts:8-11`;
   - the dependency from `resourceStreamViews.ts` on the `RefreshManager`
     type.

   The orchestrator must import nothing from navigation or React.
4. **Regression tests.** See [Validation](#validation).

## Phases

Each phase follows red/green/refactor and keeps `qc:prerelease` green. Each is
its own reviewable change. Phases are ordered by dependency.

### Phase 0: real-orchestrator test harness

- [ ] Add a harness that uses the real orchestrator, runtime, store, and
  default domain registrations.
  - Mock only `client.fetchSnapshot` and the stream managers' connection
    layer. Use fake timers.
  - After each step, report: active stream subscriptions, fetches by
    `(scope, intent)`, and armed timers.
  - Do not mock RefreshManager, `resourceStreamViews`, or domain
    registrations.
- [ ] Add characterization tests, green now, for behavior that must survive:
  - retained data paints on remount;
  - fallback polls when a stream is unhealthy, none while it is healthy;
  - `cluster-overview` polls while healthy;
  - auto-refresh off stops streams and polls, but `user` and `foreground`
    reads still run;
  - permission denial settles;
  - deferred work replays on `becameServiceable` only while leased;
  - closing a cluster tears down its work;
  - switching clusters in Overview reconciles the new cluster's
    `cluster-overview` scope (today's foreground target,
    `RefreshManager.ts:642-644`). Cover four cases: paused or not, with
    retained data or none;
  - a failed `stream-signal` read on a scope whose stream stays healthy and
    quiet is retried at its `retryAt` (today through `needsReconciliation`,
    `orchestrator.ts:1288`).
- [ ] Characterize `kubeconfig:changing` → `kubeconfig:changed` with leases
  still mounted. Today the handler deletes every runtime record, lease counts
  included (`orchestrator.ts:1952-1966`), and only effects whose dependencies
  change acquire again. Phase 1 must keep or fix this on purpose, not by
  accident.

### Phase 1: leases are the only way to enable a scope

Depends on Phase 0.

- [ ] Red tests:
  - Two consumers of one `cluster-overview` scope (ClusterOverview and
    `useClusterMetricsAvailability`): disabling one keeps the scope enabled
    and polling.
  - The YAML tab and the diff modal: closing the modal does not reset the
    tab's scope.
  - Switching clusters into Overview while paused reads the new scope once
    with `foreground`, both with retained data and without. When not paused,
    the stream may add one trailing read, and no more.
- [ ] Move each direct enabler to `useScopedRefreshDomainLifecycle` or the
  lease functions.
  - ClusterOverview declares `fetchOnEnable: 'foreground'`
    ([Activation reads](#activation-reads)).
  - NamespaceContext uses one owner component per scope, as in
    `GlobalViewNamespaces.tsx:40-50`. It keeps leasing `namespaces` for every
    open cluster: background tabs keep that subscription on purpose
    (`NamespaceContext.tsx:290-294`; `data-freshness.md`, rule 3).
  - The object-panel lifecycle helpers keep their contract: a transient unmount
    keeps snapshots, and removing the panel evicts them
    (`ObjectPanelStateContext.tsx:50-56`).
- [ ] Container logs: the lease replaces the enable and the explicit
  `stopStreamingDomain`. `restartStreamingDomain` stays as a manual command.
- [ ] Delete the direct-enable APIs and paths:
  - `setRefreshDomainEnabled` and `useRefreshDomainHandle.setEnabled`;
  - public `setScopedDomainEnabled` and `setDomainEnabled`;
  - the `enabled` activation event, which activates a scope without a lease
    (`refreshRuntime.ts:86-87`).

  The internal disable after the last release stays. The kubeconfig-changing
  handler uses internal teardown instead.
- [ ] Check each `resetDomain` caller that clears a domain in every cluster
  (`NamespaceContext.tsx:510`, `682`, `693`;
  `ClusterResourcesManager.tsx:41-53`). Remove each one that
  kubeconfig-changing teardown already covers.

### Phase 2: leases own cadence

Depends on Phase 1, because the scheduler walks only leases.

- [ ] Red tests:
  - (a) A leased snapshot scope without a stream polls at its contract
    interval and stops on release.
  - (b) The same domain leased in two clusters polls in each independently;
    releasing one leaves the other.
  - (c) A healthy stream means no poll. An unhealthy one means a poll at the
    interval plus one fallback count.
  - (d) `cluster-overview` polls while healthy.
  - (e) Auto-refresh off or a hidden document stops passive polls and retries.
    `user` and `foreground` requests still run; `stream-signal` waits
    ([decision 10](#decisions)).
  - (f) Failed polls back off once, through the runtime backoff with its 60 s
    cap.
  - (g) An open cluster with no leases makes no requests.
  - (h) Global manual refresh touches only the named cluster's leased scopes
    ([question 3](#decisions)).
  - (i) A failed read whose stream stays healthy, with no further signal:
    - it is retried at `retryAt`, and backs off after each failure;
    - retrying stops on success, on a settled permission denial, or on
      release;
    - while paused it waits, then runs after resume.
  - (j) ⌘R with a Logs tab open sends no `container-logs` snapshot request
    and queues no readiness replay for it. Check this in three states:
    connected, paused, and while the cluster is not serviceable.
  - (k) No path issues a snapshot read for a snapshotless domain.
  - (l) A read deferred until the cluster is serviceable keeps its intent:
    - a deferred `foreground` read runs on `becameServiceable` while paused;
    - deferred `startup`, `background`, and `stream-signal` work stays
      blocked while paused, and the scope reconciles after resume;
    - when deferred `foreground` and `stream-signal` merge, the replay runs
      while paused, and a healthy stream does not skip it.
  - (m) Foreground activation replays in-flight `user`, `foreground`,
    `startup`, and `stream-signal` reads with their intent, and drops
    in-flight `background` polls (`data-freshness.md`, "Errors and
    readiness").
- [ ] Add the scheduler:
  - a polling sub-state and its events in `ScopedRefreshState`;
  - one orchestrator timer for the earliest due record;
  - the contract's `timeout` on each poll fetch;
  - scheduling from settle time, which leaves `cooldown` unused
    ([question 7](#decisions));
  - a retry at `retryAt` for each scope with pending reconciliation, apart from
    fallback-poll eligibility. The retry carries the reconcile flag, so a
    healthy stream cannot suppress it;
  - a guard in `performFetch` that refuses snapshotless domains. Today only
    the initial streaming reconcile checks for them
    (`orchestrator.ts:958-966`);
  - the broker's pause predicate, applied to the orchestrator's internal
    `stream-signal` reads ([decision 10](#decisions)). A blocked read leaves
    the scope pending, and it reconciles after resume;
  - **one typed request intent end to end.**
    - Today the broker reduces its reason to two booleans
      (`isManual: reason === 'user'`, `streamSignal: reason ===
      'stream-signal'`; `dataAccess.ts:80-84`). In-flight requests
      (`refreshRuntime.ts:4-17`) and deferred readiness requests
      (`:141-148`, merged at `:158-180`) keep only those flags. That makes
      `foreground`, `startup`, and `background` indistinguishable when
      deferred work replays (`orchestrator.ts:213-221`, `:242-247`).
    - Replace the flags with one `RefreshIntent` union (`startup`,
      `foreground`, `background`, `stream-signal`, `user`; the same values
      as `DataRequestReason`, `data-access/types.ts:14`). Carry it through
      fetch options, in-flight requests, deferral, and replay, so the pause
      predicate can judge replays.
    - A merged deferral keeps every merged intent. On replay, intents the
      pause predicate blocks are dropped and leave the scope pending. The
      read runs with the strongest remaining intent, and `stream-signal`
      still exempts it from the healthy-stream skip;
  - a pause input fed by `settings:auto-refresh` and the existing
    `app:visibility-hidden`/`app:visibility-visible` events
    (`RefreshManagerContext.tsx:42-47`). The object-panel timers still use
    RefreshManager's pause until Phase 5.
- [ ] Remove the RefreshManager path from the orchestrator:
  - `registerDomain` subscriptions;
  - `ensureRefresher`, `resolveTiming`, `shouldAllowRefresher`,
    `reconcileRefresherActivity`;
  - `DEFAULT_AUTO_START`;
  - the refresher call in `triggerManualRefreshForContext`.
- [ ] Manual refresh by `clusterId`, through `requestContextRefresh` and its
  three callers (`App.tsx:199`, `CommandPaletteCommands.tsx:468`,
  `ConnectivityStatus.tsx:68`).
  - Snapshot leases fetch with `user`.
  - Query leases advance their reconcile identity.
  - Healthy resource streams run `refreshOnce`.
  - Snapshotless domains (`container-logs`) are skipped.
    - They have no snapshot endpoint and no `refreshOnce`
      (`domainRegistrations.ts:32-44`).
    - The orchestrator's fallback would restart the log stream
      (`orchestrator.ts:688-695`).
    - The Logs tab keeps its own restart control (`LogViewer.tsx:705`).
- [ ] Emit `refresh:start` and `refresh:complete` from the manual command
  ([question 8](#decisions)). This keeps `useAutoRefreshLoadingState` and
  ConnectivityStatus working.
- [ ] Diagnostics: the polling column reads each scope's polling state.
- [ ] Characterization: switching views while paused still paints a fresh
  first page. Query tables read with `user` (`useTypedResourceQuery.ts:577`).
  This replaces RefreshManager's foreground targets
  (`RefreshManager.ts:620-647`).

### Phase 3: leases own streaming; delete the view gate

Depends on Phase 2. Its tests rely on Phase 2's lease-owned fallback polling
while a stream is down or retrying.

- [ ] Red tests:
  - (a) A leased resource-stream scope streams with no navigation published
    (the native-window case).
  - (b) The last release stops it, in both demand modes.
  - (c) `fetchScopedDomain` or `requestRefreshDomain` on an unleased scope
    never starts a stream.
  - (d) Gate proof: a lease taken while the cluster is not serviceable starts
    nothing; `becameServiceable` then starts the stream and its initial
    reconcile.
  - (e) A failed start retries with backoff while leased, and stops retrying
    on release.
  - (f) Auto-refresh off stops streams; turning it back on restarts only
    leased scopes.
  - (g) The panel metrics collector's `namespace-workloads` lease streams
    instead of polling ([question 5](#decisions)).
- [ ] Remove the stream starts in `reconcileQueryOnlyDemand` and
  `reconcileStreamingFetch` (`orchestrator.ts:1236-1238`, `:1279-1281`). Add a
  start-retry event to the stream sub-state.
- [ ] Delete:
  - the view tables and `isResourceStreamViewActive` (and move
    `isResourceStreamDomain`);
  - `disableNamespaceDomains`;
  - `activePodsTableScope` and `triggerActivePodsTableRefresh`;
  - the context branch of `handleStreamingScopeChanges`.
- [ ] Re-evaluate streams after the blocks are cleared on
  `kubeconfig:changed` and `kubeconfig:selection-changed`
  (`orchestrator.ts:1995-2008`). Today the next poll restarts them; after this
  phase nothing else does.
- [ ] Red test for the behavior change: returning to a namespace view repaints
  that scope's retained snapshot. Today `disableNamespaceDomains` clears it.

### Phase 4: object-details change signal

Decided by John on 2026-10-19 ([question 1](#decisions)). Depends on
Phase 2, whose lease-owned polling is the backstop. Wiring follows
[question 9](#decisions).

Today's polling mostly re-reads a cache:

- Object details are cached for 10 s (`ResponseCacheTTL`,
  `backend/internal/config/config.go:68`).
- Informer events evict that cache:
  - per object: `backend/response_cache_invalidation.go:336`;
  - every Pod-listing workload in a namespace, on a Pod change: `:311`;
  - Helm releases: `:384`;
  - custom resources: `:144`.
- A poll therefore returns new details only after an eviction, or after the
  10 s expiry.

This phase rings a signal at those evictions, so open panels refetch right
after a change. A 10 s poll remains as the backstop for kinds without
eviction.

- [ ] Red tests. They follow `data-freshness.md`, "Required evidence for
  resource-source changes", and each one must fail with the signal wiring
  removed.
  - With a panel open and a healthy stream, a change reaches the Details tab
    through the production eviction and signal, with no poll and no manual
    refresh. Cover create, update, and completed delete, and assert before
    the 10 s expiry.
  - A Pod change rings each open workload panel in that namespace whose
    details list Pods.
  - A signal-triggered read never returns the cached copy from before the
    change. The signal rings only after the eviction.
  - Only open scopes that match the change receive the signal.
  - A kind with no eviction still refreshes through the 10 s backstop.
  - Resync echoes ring nothing.
    - An informer update with an unchanged `resourceVersion` sends no
      signal and causes no signal-triggered read. Informers resync every 15 s
      (`backend/internal/config/config.go:33`).
    - An ingest relist that re-upserts unchanged rows also sends no signal.
    - A real update right after an echo still rings.
    - Tests must set `resourceVersion` explicitly. The fake clientset leaves
      it empty, and an empty old version counts as a real change
      (`backend/refresh/snapshot/informer_echo.go:16`).
- [ ] Backend:
  - Add a details change notifier modeled on `ObjectEventsChangeNotifier`
    (`backend/refresh/snapshot/object_events_notifier.go`), with a matching
    broadcast like `BroadcastObjectEventsRefresh`
    (`backend/refresh/resourcestream/manager.go:634-652`).
  - Move the response-cache handler registration from the gateway to the
    refresh coordinator ([question 9](#decisions)). Each handler calls
    the gateway's invalidator and then records the change key in the
    notifier, in that order.
  - Record only real changes, as `data-freshness.md` requires for doorbells
    (`:116-119`). Cache eviction itself may stay unconditional.
    - **Informer path.** Today's update handler drops the old object
      (`response_cache_invalidation.go:214`). The moved handler keeps it and
      skips echoes with `informerUpdateIsEcho`
      (`backend/refresh/snapshot/informer_echo.go:10-17`).
    - **Ingest path (ingest-owned kinds such as Pods).** A relist upserts
      every row to the catalog sinks (`refresh/ingest/projecting_store.go:818-827`),
      and the sink gets no old object. Compare each row's `ResourceVersion`
      (`objectcatalog/types.go:67`) with the row it replaces. Either the
      projecting store passes the previous row, or the notifier remembers
      the last version per watched key. The notifier must not grow a map
      covering every object.
  - Existing eviction tests must pass unchanged.
- [ ] Contract and frontend:
  - In the contract, give `object-details` `sourceClocks: ["object"]` and the
    `doorbell-snapshot` orchestrator.
  - Keep its `interval` at 10 s as the backstop.
  - Add a frontend doorbell descriptor with
    `pollingContinuesWhileStreaming: true`, like `cluster-overview`
    (`streaming/resourceStreamDomains.ts:71-74`).
  - Regenerate the contract artifacts.
- [ ] Check stream permissions. `object-details` is permission-exempt in the
  contract, but the stream subscription must not reveal more than a snapshot
  read would.
- [ ] Until Phase 9, the Details tab refetches through
  `useStreamSignalRefetch`. `streamConsumerDrift.test.ts` will require it once
  the domain streams.

### Phase 5: object panel uses its leases' cadence

Depends on Phases 2 and 4.

- [ ] Red tests:
  - Two open panels refresh their own details on their own signals, with the
    10 s backstop. Closing one leaves the other refreshing.
  - A hidden dock tab does not poll details.
  - The Events tab refreshes on its doorbell, and polls every 3 s only while
    its stream is unhealthy.
- [ ] Set the `object-events` contract `interval` to 3000 ms
  ([question 2](#decisions)), and regenerate.
- [ ] Delete:
  - the register and `useRefreshWatcher` blocks in `useObjectPanelRefresh.ts`
    and `EventsTab.tsx`;
  - `getObjectDetailsRefresherName` and `getObjectEventsRefresherName`
    (`ObjectPanel/constants.ts:68-95`);
  - the `ObjectRefresherName` types.

### Phase 6: delete RefreshContext

Depends on Phases 2 and 3.

- [ ] Red test: closing a cluster prunes its runtime, leases, streams, and
  retained scopes, and leaves other clusters alone. Existing pruning tests move
  to the new input.
- [ ] Replace `updateContext` with `setConnectedClusters(clusterIds)`, called
  from `KubeconfigContext.tsx:275-300`.
- [ ] Delete:
  - the other 11 writers;
  - `RefreshSyncProvider`'s refresh effect (`ViewStateContext.tsx:438-455`);
  - NsResourcesContext's publishing effect;
  - NamespaceContext's deferred publish (`:645-662`);
  - the unused getters;
  - `ContextRefreshRequest.context` (`core/data-access/types.ts:63`).

### Phase 7: remove background cluster refresh

Decided by John on 2026-10-19 ([question 4](#decisions)). Depends on
Phase 6.

- [ ] Gate before deleting anything. In the dev app with two clusters open,
  compare tab return with the setting on and off. Check each table view
  (Workloads, Pods, Nodes, Events) and Overview.
  - Expect the same table behavior: last rows from the replay cache, then a
    fresh page.
  - Overview should show retained data, then refresh on mount.
  - If any surface renders the background-fetched base snapshot, stop and
    bring it to John.
- [ ] Red test: with two clusters open, the inactive cluster makes no polls.
  It keeps only its `namespaces` subscription and fetches only when that
  doorbell rings.
- [ ] Delete the poller:
  - `backgroundClusterRefresher.ts` and `useBackgroundClusterRefresh.ts`;
  - the mount at `KubernetesProvider.tsx:31`;
  - their tests.
- [ ] Delete the preference end to end:
  - frontend:
    - `appPreferences.ts` (field, default, metadata, normalizer, getter,
      setter);
    - `useBackgroundRefresh.ts` and `useBackgroundRefreshEnabled`;
    - the toggle in `AdvancedSection.tsx:161-171`;
    - the `index.ts` export;
    - `backgroundRefreshEnabled` in `KubeconfigContext.tsx:275-300`;
  - backend:
    - `RefreshBackgroundClustersEnabled` in
      `backend/resources/types/types.go:50`;
    - `backend/preferences_settings.go:39`, `:742`;
    - `backend/preferences_settings_data.go:226-227`;
    - their tests, including `application_runtime_contract_test.go`.
- [ ] Before removing the field, confirm that existing `settings.json` files
  that still contain it load cleanly: either unknown JSON fields are ignored,
  or a migration drops the field.
- [ ] Add a `docs/release/pending.md` note that the setting was removed.

### Phase 8: delete RefreshManager and refresher names

Depends on Phases 2, 5, 6, and 7.

- [ ] Delete, with their tests:
  - `RefreshManager.ts`, `refresherRuntimeState.ts`, `refresherTypes.ts`,
    `refresherConfig.ts`, `useRefreshWatcher.ts`;
  - `REFRESHER_TIMING_BY_NAME` and `DOMAIN_REFRESHER_MAP`;
  - the view registry's `refresher` fields
    (`core/navigation/viewRegistry.ts:18`), which have no readers once
    Phase 7 is done;
  - `fetchDomainForCluster`, and the `allowDisabledRetainedScope` path in
    `canFetchScope`, `applyFetchResult`, and `applySnapshot`;
  - the `refresh:registered` and `refresh:state-change` events.
- [ ] Move the `visibilitychange` listener, the only work left in
  `RefreshManagerProvider`, to the app root, and remove the provider from
  `KubernetesProvider.tsx:52` and `PanelWindowApp.tsx:313`. `useAutoRefresh`
  keeps only the preference.
- [ ] Delete fields:
  - `refresherName`, `scheduled`, and `pauseRefresherWhenStreaming` from
    `DomainRegistration` and `StreamingRegistration`
    (`refreshRegistration.ts:5-25`);
  - `frontend.refresherName`, `frontend.scheduled`, and
    `frontend.timing.cooldown` from the contract JSON
    and the generator.

  Run `go generate ./backend`. The stale-artifact and parity tests must pass.

### Phase 9: snapshot leases own signal refetch

Decided by John on 2026-10-19 ([question 6](#decisions)). Depends on
Phase 2.

- [ ] Red tests:
  - A snapshot lease refetches once with `stream-signal` when a declared clock
    advances, with no consumer hook.
  - Two consumers of one scope cause one fetch.
  - Applying a payload never triggers a refetch. The refetch keys only on
    declared signal clocks, never on `sourceVersion`
    (`data-freshness.md`, "Signals and source clocks").
  - The first signal after a lease starts is not lost. A signal that arrives
    during an in-flight read causes exactly one trailing read.
  - A query-only lease never fetches the base snapshot on a signal.
  - While auto-refresh is off, a signal does not refetch. The scope stays
    pending and reconciles after resume ([decision 10](#decisions)).
- [ ] Move doorbell → refetch into the orchestrator for snapshot demand. Delete:
  - the snapshot path of `useStreamSignalRefetch` and `sharedScopeSignals`;
  - the 9 calls in 8 files;
  - `streamConsumerDrift.test.ts`.

  `useQueryStreamSignal` stays, because query pages belong to their consumers.

### Phase 10: docs and plan removal

- [ ] Update:
  - `data-freshness.md`:
    - request intents: activation reads come from stream starts and
      `fetchOnEnable`, not from navigation;
    - the `stream-signal` row of the intent table (`:42`), per
      [decision 10](#decisions);
    - failed-read retries are scheduled per scope.
  - `refresh-system.md`: ownership, frontend runtime state, and the scheduler.
    Replace "Context changes abort, then reconcile" (`:153`) with the lease
    rule: a scope change releases the old lease, which cancels its in-flight
    work (`orchestrator.ts:494-498`), then acquires the new one.
  - `domain-wiring.md`: the frontend table.
  - `biome.md:46`: the example.
  - `refresh-system.md` ("Snapshot caches") and
    `docs/architecture/backend-services.md`: Refresh owns the response-cache
    eviction handlers and rings `object-details` after invalidating
    ([question 9](#decisions)).
  - `data-freshness.md`: `object-details` as a domain that keeps polling while
    streaming.
- [ ] Run `qc:docs`, then delete this plan.

## Decisions

1. **Object-details cadence.** **Decided (John, 2026-10-19):** add a change
   signal for `object-details` ([Phase 4](#phase-4-object-details-change-signal)).
   Every kind keeps the contract's 10 s poll as a backstop, so no per-kind
   interval is needed.
   - Before: Pods polled every 2 s and other kinds every 5 s, set by the panel
     (`useObjectPanelRefresh.ts:139`).
   - The polls mostly re-read the backend's 10 s details cache.
2. **Object-events cadence.** **Decided (John, 2026-10-19):** drop the Events
   tab's 3 s timer, and set the `object-events` contract interval from 10 s to
   3 s.
   - With a healthy doorbell, the timer's fetches are already skipped
     (`orchestrator.ts:1283-1297`, `refreshRuntime.ts:1057-1081`). The 3 s
     contract interval keeps today's fallback speed while the stream is down.
   - It also matches `cluster-events` and `namespace-events`, which are 3 s in
     the contract.
3. **Manual refresh scope.** **Decided (John, 2026-10-19):** ⌘R, the
   palette's **Refresh current view**, and the connection-status action
   refresh every leased scope of the foreground cluster. That covers visible
   tables, the open panels' active tabs, sidebar badges, and Overview metrics.
   - Before, they refreshed:
     - the active view's domain in every cluster with an enabled scope;
     - `namespaces` in every open cluster;
     - the active Pods table.
   - Before, they skipped panels, badges, and views without a refresher name
     (namespace Map, Custom).
4. **Background refresh.** **Decided (John, 2026-10-19):** remove the
   feature and its setting, after a runtime check
   ([Phase 7](#phase-7-remove-background-cluster-refresh)).
   - Settings → Advanced → **Refresh background clusters** is on by default
     (`appPreferences.ts:203`). It refetches each inactive cluster's
     last-viewed base snapshot every 15 s
     (`backgroundClusterRefresher.ts:21`, `:131-181`).
   - Query-backed tables never render that snapshot
     (`useQueryBackedResourceGridTable.ts:102-106`). On return they show
     their replay-cache rows and then read a fresh page
     (`useResourceInventoryTable.ts:25-30`, `useTypedResourceQuery.ts:577`).
     This is a code-path reading. Phase 7 checks it in the app before
     deleting anything.
5. **Panel metrics collector.** It holds a metrics lease for the panel's whole
   life, even behind other dock tabs (`ObjectPanel.tsx:123-126`).
   - Its leases are on `nodes`, or on `pods`/`namespace-workloads` per
     namespace. Today they poll every 5 s unless the main window's view
     matches, and they always poll in a native window.
   - **Decided (John, 2026-10-19):** stream like any other lease. No special
     case for the collector.
     - Metric signals ring about every 5 s by default
       (`backend/internal/config/config.go:55`). With metrics-server present,
       the refetch rate stays about the same as today's poll.
     - Object changes show immediately.
     - Without metrics-server, refetches happen only on change.
     - The gain is consistency across views and windows, not fewer
       requests.
6. **Signal refetch.** **Decided (John, 2026-10-19):** include
   [Phase 9](#phase-9-snapshot-leases-own-signal-refetch), after Phase 2.
   - Snapshot leases refetch on signals in the orchestrator.
   - This deletes the 9 `useStreamSignalRefetch` calls, the dedupe map, and
     `streamConsumerDrift.test.ts`.
   - Query tables keep `useQueryStreamSignal`.
7. **Contract `cooldown`.** **Decided (John, 2026-10-19):** drop it from the
   contract, the generator, and the generated files in Phase 8.
   - Polls are scheduled `interval` after the previous one settles.
   - Failures use the runtime backoff (`refreshRuntime.ts:717-726`).
   - The period stretches by the fetch time.
8. **Connectivity dot "refreshing" state.** **Decided (John, 2026-10-19):**
   only manual refresh (⌘R, **Refresh Now**) emits `refresh:start` and
   `refresh:complete`. Polls and signal refetches stay quiet.
   - Before, every RefreshManager run toggled the dot
     (`ConnectivityStatus.tsx:36-37`), with one on/off flag for overlapping
     runs.
   - `useAutoRefreshLoadingState` counts only manual runs, so it is
     unaffected.
9. **How the details signal rings after eviction (Phase 4).** The signal must
   ring after the cached details are evicted. Otherwise the refetch reads the
   stale copy, and nothing rings again until the cache expires
   (`data-freshness.md:117` describes this race between informer handlers).
   - **Decided (John, 2026-10-19): Refresh owns the eviction handlers.**
     Refresh registers the informer and ingest handlers itself. Each event
     calls the gateway's existing invalidators, then rings the signal, in
     that order, in the same handler.
   - This follows the documented direction: "Refresh may read Cluster Runtime
     and invoke gateway invalidators; neither calls back into Refresh"
     (`refresh-system.md:88-89`; `backend-services.md:85-87`). No exception
     is needed.
   - Today Refresh asks the gateway to wire its own handlers onto
     Refresh-owned informers (`backend/refresh_setup.go:318` →
     `response_cache_invalidation.go:49`).
   - The registration code moves from gateway methods to the refresh
     coordinator (`response_cache_invalidation.go:49-222`, plus the ingest
     sink at `:260-291`). It is in the same Go package. The gateway keeps the
     cache and its invalidators.
   - Rejected:
     - an after-eviction hook from the gateway into Refresh, which would need
       an exception to the rule;
     - uncached signal reads, which would make a live read, including Pod
       lists for workloads, on every signal.
10. **`stream-signal` while auto-refresh is off.** **Decided (John,
    2026-10-19): keep blocking.** Raised by that day's plan review.
    - Paused means no automatic updates. `stream-signal` reads wait while
      paused, and the scope stays pending.
    - After resume, streams reconnect, and their first RESET reconciles every
      scope with retained data.
    - **The mismatch it settles.** The contract's intent table said
      `stream-signal` runs while paused (`data-freshness.md:42`). The broker
      blocks it (`dataAccess.ts:25-34`), and the refetch hook documents that
      the pause applies (`useStreamSignalRefetch.ts:10-12`).
    - **Impact is small.** Streams stop while auto-refresh is off
      (`orchestrator.ts:785-787`), so only a signal latched before the pause
      is affected.
    - **Changes:**
      - Use the broker's predicate everywhere: the scheduler; Phase 9; and
        the orchestrator's internal `stream-signal` reads, which skip the
        broker today:
        - the initial streaming reconcile (`orchestrator.ts:967-970`);
        - the trailing read (`:1563-1567`);
        - readiness replays (`:242-247`).
      - Correct the doc row to "No".

## Validation

### Automated

These tests use the real orchestrator harness from Phase 0. React tests
render the real lease hooks against it.

- **Stream invariant.** At every step, active stream subscriptions equal the
  leased streaming scopes that are all of:
  - serviceable;
  - not blocked;
  - not one-shot queries;
  - in a session with auto-refresh on and the document visible.

  Assert it after each action in sequences that:
  - switch views within a cluster (mount and unmount `ClusterResourcesViews`
    and `NsResourcesViews` tabs);
  - switch cluster tabs (the selected cluster changes; the old views
    unmount);
  - switch the active tab in a dock group, open and close Logs, YAML, and
    Metrics, and close a panel;
  - mount a panel without any navigation provider (the native-window case);
  - close a cluster;
  - fail and recover auth;
  - rebuild the namespace scope;
  - toggle auto-refresh;
  - hide and show the document.
- **No unleased requests.** No path requests an unleased scope: scheduler,
  fetch path, signal, readiness replay, or auth recovery.
  `fetchDomainForCluster` and `allowDisabledRetainedScope`
  (`orchestrator.ts:723-739`) go away with the background poller.
- **Gate proofs (AGENTS.md).**
  - Blocked: no stream or fetch before the cluster is serviceable or during
    foreground activation; no passive work while auto-refresh is off; nothing
    after release.
  - Allowed:
    - the same lease reaches a healthy stream and its initial snapshot after
      `becameServiceable`;
    - `user` and `foreground` reads run while paused;
    - a settled permission denial reopens on an epoch reset.
- **Seam checks** (`data-freshness.md`, "Seam checks"):
  - an inactive retained scope creates no demand;
  - the activation boundary does not turn passive work into queued demand;
  - every open cluster unavailable at once.
- **Gates per phase:**
  - coverage of changed files at 80% or more
    (`mise exec -- wails3 task test:frontend-coverage`);
  - cognitive complexity of 12 or less in changed functions;
  - `mise exec -- wails3 task qc:prerelease`.

### Native

In the Wails app, not a browser preview. Use a dev or staging kubeconfig, and
check the persisted cluster selection before launching.

- **Diagnostics (Cluster Data):** each scope's stream and polling state matches
  the visible view while switching views, cluster tabs, and dock tabs. No
  stream remains for a closed view.
- **Two clusters open:** the inactive cluster holds
  only its `namespaces` subscription. It makes no polls, and fetches only when
  that doorbell rings.
- **Native panel window:** its metrics and Pods tab stream.
- **Tab return:** retained data repaints at once, with no blank and no
  spinner.
