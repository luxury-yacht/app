# Multi-Cluster Contract

Every cluster is independent: auth, refresh state, caches, navigation, runtime
operations, permissions, and object actions for one cluster never affect another.

## Agent Contract

- Besides the root `AGENTS.md` list, APIs, stores, and diagnostics carry
  `clusterId`.
- The active tab is foreground selection only; never infer a cluster from it
  after data crosses a boundary. Missing, ambiguous, or stale cluster identity is
  an error, never a fallback to the current cluster.
- Open inactive tabs are retained workspaces, not disposed views. Activation and
  background refresh follow [data freshness](data-freshness.md); selection adds
  no readiness delay and never turns inactive tabs into producer demand.
- Refresh domains are single-cluster; cross-cluster views fan out over
  per-cluster state, never aggregate scopes.
- Every add/close/replace/clear goes through `KubeconfigContext`'s unified
  selection transition (`openKubeconfig`, `closeKubeconfig`,
  `setSelectedKubeconfigs`). UI never splices selected clusters locally or calls
  generated backend selection/close commands.
- Add/remove updates aggregate refresh handlers and object-catalog services via
  the live update path, not only initial setup. Removal cleans refresh
  subsystems, catalog state, runtime operations, stream subscriptions, and
  cluster-scoped UI state.
- Frontend lifecycle, auth, health, namespace-scope revision, selection, and
  visible-cluster state project one cluster-workspace state plane; never add
  another cluster-keyed cache in a React context or hook.
- Test open/add and close/remove/clear paths, distinguishing foreground,
  background-open, and removed-cluster states.

## Identity And Scopes

`clusterId` is stable app identity for a selected kubeconfig context; the same
context name in two kubeconfig files can be two clusters. Refresh scopes are
cluster-prefixed (`clusterId|`, `clusterId|namespace:default`,
`clusterId|<domain-specific-scope>`). Unsupported multi-cluster scope strings
are parsed only to return validation errors; frontend code never produces them.

## Ownership

Owner map and dependency directions: [backend-services](backend-services.md).

- Beyond that map: `ClusterRuntimeManager` also owns watcher retargeting,
  cluster metadata and lifecycle state, dependency resolution, and heartbeat
  probes; `WorkspaceCoordinator` owns supersession generations, selection
  diagnostics, and namespace-scope rebuild coalescing; `RefreshCoordinator` owns
  aggregate routing. Neither Cluster Runtime nor Refresh calls back into
  Workspace.
- `ClusterWorkspaceProjection` is a leaf: source owners write through narrow
  methods; it owns no clients, selections, or refresh subsystem.
- Watcher, auth, and transport producers publish typed `ClusterRuntimeIntent`
  values to an owner-local queue, non-blocking and coalesced by intent kind plus
  `clusterId`. Workspace, the single consumer, rejects stale generations per
  kind/cluster and routes accepted work through the serialized selection
  boundary. Shutdown stops the consumer before auth recovery and the watcher can
  publish more.
- `ClusterRuntimeManager` stores pushed QPS/burst for future clients and retimes
  existing mutable limiters and API-metrics entries; it never reads Preferences.
- `ClusterAttentionService` (`backend/cluster_attention_service.go`,
  `cluster_attention_rules.go`) owns the Attention lock, six Ignore/Restore
  commands, and the cluster-indexed live target registry; it persists through a
  narrow `PreferencesService` repository and never reaches through Refresh.
- Frontend (`frontend/src/`): `core/cluster-workspace/clusterWorkspaceStore.ts`
  (state, runtime-event reconciliation),
  `modules/kubernetes/config/KubeconfigContext.tsx` (selection UI),
  `core/refresh/clusterScope.ts`, `ui/layout/ClusterTabs.tsx`,
  `core/contexts/ViewStateContext.tsx` (Global/per-cluster navigation).
- Backend starting points:
  [cluster-auth-lifecycle skill](../../.agents/skills/cluster-auth-lifecycle/SKILL.md).

## Cluster Workspace State Plane

### Backend snapshot

- `GetClusterWorkspaceStateForWindow` returns the peer's selected contexts and
  foreground intent plus process-wide, cluster-indexed lifecycle, auth, health,
  and namespace-scope revisions.
- `ApplyClusterWorkspace` updates the peer's complete tab set before
  visible-cluster activation and returns the authoritative per-window snapshot;
  selection UI uses it instead of chaining selection/auth/lifecycle reads.
- Each workspace-visible state writer advances the workspace revision under its
  own lock, in the same commit; capture retries if the revision moves.
- Public reads take the peer-selection lock, not the serialized selection-work
  boundary, so unreachable clusters cannot block hydration.
- Visibility-only `ApplyClusterWorkspace` bypasses the selection boundary without
  advancing or cancelling its generation. Tab-set changes stay ordered (no
  window supersedes another's mutation) and capture their snapshot before
  releasing the boundary.
- The connection generation is replaced only when the process-wide selection
  changes; panel retain/release, view moves, and duplicate-view open/close keep
  in-flight clients and auth results.

### Process selection union

- The backend keeps one cluster-tab set per app window plus cluster-scoped panel
  references; their deterministic union owns process-wide selected kubeconfigs,
  clients, refresh subsystems, catalogs, and runtime operations. Teardown
  requires that no app view or panel reference retains the cluster.
- Closing a tab releases only that view while another app window shows the
  cluster. Closing the final app tab first guards and closes its native panel
  windows and discards its shared panels; closing an app window instead keeps
  docked panels and leaves floating panels open.
- The native close command records a view's removal before another close
  decides finality; renderer selection reconciles that result.
- Cluster-tab moves stage the target before removing the source. A panel-only
  renderer projects its fixed cluster without an app-view tab set
  ([panel workspaces](application-lifecycle.md#cluster-owned-panel-workspaces)).
- Adding a panel reference to an owned selection, or releasing one while another
  owner remains, takes only the short workspace-ownership lock. Check and update
  are atomic, so no reference bypasses retirement after the last owner leaves.
  Final-reference release stays serialized with teardown; both join the
  shutdown drain.

### Open and selection ordering

- Selection acknowledgement follows the membership and restart-selection
  commit, before connecting; the connection work after it stays inside the
  serialized mutation and shutdown drain.
- The renderer serializes membership RPCs in user order and paints tab identity
  immediately; foreground commands use an independent ordered lane, so a later
  tab switch beats an earlier membership ack.
- Reopens wait for close guards and accepted removal. Discovery hydration and
  delayed command snapshots never overwrite newer selection intent or lifecycle
  events; discovery reads deferred by a membership change or close rerun after
  it settles, reconciling discovered removals against the latest backend
  selection.

### Close

- A close click removes the tab and selects its neighbor immediately, even with
  a pending open ack or native close.
- `selectedKubeconfigs`/`selectedClusterIds` are visible tabs;
  `managedKubeconfigs`/`managedClusterIds` keep closing clusters until native
  removal is accepted. Persisted tab order, panel publication and ownership,
  navigation (including Global), sidebar, and namespace retention use the
  managed set, so denial restores position and state.
- Local close guards run before switching away can unmount their controls;
  native removal waits for the prior tab admission. Each close captures its
  preflight participants before awaiting them; later foreground changes cannot
  add a second native close to that transaction.
- Native close is that close's sole membership mutation. A participant must
  report a native commit for the requested cluster, or the close fails and the
  tab returns. After acceptance the renderer adopts the removal without another
  full-set membership write.
- A sibling close may be committed while its response is in flight; renderer
  snapshots cannot order it. No exclusion set survives a close, so transfer
  hydration can readmit the cluster.
- Panel directory reads, object opens, and docked publication require confirmed
  membership; optimistic tab visibility never authorizes native panel access.
  This gate neither waits for connection readiness nor blocks the membership
  command.
- The renderer holds the cluster's request gate before native preflight, aborts
  its requests and streams, and prunes its refresh runtime on acceptance. Denial
  or failure releases the hold, resumes retained work, and restores the tab
  without overriding a newer foreground choice. Only accepted removal disposes
  retained state.
- Panel guards and publication flushes finish before acceptance. The close ack
  precedes client, refresh, and catalog cleanup, which stays inside the
  serialized selection mutation and shutdown drain; reopens and later mutations
  wait for it. Cleanup failures go to selection diagnostics and cluster-scoped
  logs without restoring the tab.
- Catalogs of surviving clusters persist across selection changes; catalog
  teardown belongs to removal or replacement of the owning refresh generation.
- Frontend stream/snapshot continuations belong to the runtime instance that
  started them; once removal retires it, queued work cannot recreate it, late
  subscriptions are disposed, and late failures cannot republish. Reopen
  creates a new runtime.

### Connection work and failure

- A process-selection change may cancel obsolete connection work before
  waiting for the selection mutation; ownership changes that leave the union
  unchanged keep in-flight authentication.
- Admitted tabs report later connection failure through lifecycle state and
  selection diagnostics. Client construction records failure per cluster and
  collects batch errors without cancelling healthy siblings; open, close,
  release, pruning, and startup share that failure owner.
- Refresh publication proceeds with the installed clients when another build
  fails; with none left it retires the previous refresh runtime. Failed tabs stay
  admitted and unavailable; guidance is close and reopen, since refreshing
  cannot rebuild missing clients.
- Discovery and preflight propagate the connection context so cancellation
  drains their HTTP requests.
- Closing a canceled connection removes lifecycle and API-diagnostics entries
  that never acquired clients. API diagnostics retire with shared workspace
  state on deselection, pruning, and final-tab clearing; peer-owned clusters keep
  diagnostics and request history.

### Startup and search paths

- Startup runs `PreferencesService.EnsureLoadedForStartup` before entering the
  selection mutation, then restores the immutable selected-kubeconfig snapshot
  inside it. Client
  preflight runs outside the lock with that generation's cancellation context,
  so a newer selection can cancel it without waiting on an unreachable API
  server; success re-enters the boundary before publishing refresh and catalog
  state. Startup connection work never holds the native runtime-ready callback.
- Search-path changes persist first, have Cluster Runtime rediscover and
  retarget the watcher, classify removed selections, then reconcile refresh,
  selections, clients/auth, operations, projection state, and the persisted
  remainder.

### Frontend store

- The React-free `clusterWorkspaceStore` subscribes to runtime events before
  initial hydration. Live fields beat only hydration responses already in flight
  when the event arrived; later snapshots heal missed state.
- It owns the foreground activation/serviceability boundary and immutable
  snapshots. `AuthErrorContext`, `ClusterLifecycleContext`, health hooks, and
  refresh readiness are selector facades; internal event-bus emissions are
  wake-ups, never a second cache.
- Initial hydration publishes discovered kubeconfigs and the restored tab set
  before awaiting foreground activation, whose hold gates cluster-data refresh;
  activation failure cannot erase discovery or tab selection.
- The `no-direct-cluster-workspace` Biome plugin restricts the combined
  workspace RPC and lifecycle/auth/health/namespace-scope Wails events to
  `frontend/src/core/cluster-workspace`.

## Global Clusters View

Global workspace rules (entry/exit, staged links, fan-out) live in
[navigation](../frontend/navigation.md). Multi-cluster specifics:

- While Global is selected the foreground kubeconfig keeps backend priority but
  its tab is not visually active.
- **Global → Clusters** fans out `cluster-overview` over one `clusterId|` scope
  per eligible open cluster. Rows keep the originating `clusterId` and use
  overview-owned readiness, capacity, workload, metrics, and
  unavailable-resource projections.
- Each eligible cluster has its own keyed lease owner; adding or removing one
  touches only its lease, never cycling survivors' leases or startup fetches.
  Global table persistence, pagination, and replay-cache ids are fixed per
  Global view, never derived from membership.
- Lifecycle and confirmed auth failures stay per row (ready, loading,
  reconnecting, disconnected, auth-required together); no overview refresh
  starts for a cluster whose lifecycle cannot activate that domain.
- Only the Cluster link is interactive: it prepares the destination's
  navigation and sidebar, activates its kubeconfig, and opens its Overview. The
  Needs Attention cell (not-ready nodes, failing pods) is not a link.
- The internal `fleet` route and `cluster-fleet` table-persistence id are
  compatibility identities for **Global → Clusters**.
- **Global → Namespaces** reads each open cluster's `namespaces` entry (no
  aggregate scope), uses **Cluster → Namespaces** columns plus cluster name, and
  keeps full row identity. Row navigation stages that cluster's namespace,
  namespace Browse view, and sidebar before activating it. Any open cluster
  without a namespace snapshot (denied or unavailable) marks the table partial.
