# Findings: 2025-01-30 Multi-Cluster Isolation Design

Reviewed on 2026-01-30 against current code in `backend/` and `frontend/`.

## Findings (ordered by severity)

- High: Auth event name mismatch is real; frontend subscribes to `auth:*` while backend emits `cluster:auth:*`, so auth failure/recovery events never reach the UI. This supports Section 5/8 as written. Files: `frontend/src/hooks/useAuthErrorHandler.ts:5-79`, `backend/cluster_auth.go:37-72`.

- High: `rebuildRefreshSubsystem` still clears global clients and replaces `clusterClients` entirely, so a single recovery/transport rebuild wipes all clusters. This supports Section 3's isolation concern; it is invoked from auth recovery and transport rebuild paths. Files: `backend/app_refresh_recovery.go:191-206`, `backend/app_refresh_recovery.go:162-186`, `backend/app_refresh_recovery.go:258-284`.

- Medium: Heartbeat is still single-cluster/global. It uses `a.client` and updates a global connection status, so a single failure can mark the app offline even if other clusters are healthy. This supports Section 2's rationale. File: `backend/app_heartbeat.go:31-56`.

- Medium: Section 1 correctly identifies global client fields, but its file list is incomplete. Additional live references to global refresh/telemetry/informer state exist beyond the files listed, so scope is larger than documented. Examples: `backend/app_refresh_setup.go:302-316` (writes `refreshManager`, `telemetryRecorder`, informer factories), `backend/app_object_catalog.go:153-193` (falls back to `a.telemetryRecorder`).

- Medium: Section 6 proposes removing global connection status, but the app still uses `connection-status` events and global transport/auth state to drive UI updates. Removing these without a per-cluster replacement would regress existing UI behavior. Files: `backend/app_connection_status.go:37-95`, `frontend/src/hooks/useWailsRuntimeEvents.ts:71-86`, `backend/cluster_auth.go:75-76`, `backend/app_refresh_recovery.go:217-226`.

- Medium: Retry flow is still global and partially wired. The frontend emits `auth:retry-requested`, but there is no backend listener, and the direct binding calls `RetryAuth` (global) rather than `RetryClusterAuth`. This will not support per-cluster retry as proposed. File: `frontend/src/hooks/useAuthErrorHandler.ts:21-35`.

- Medium: Node drain history is stored in a process-global store with no cluster scoping; the snapshot only filters by node name and then stamps the current cluster meta, so drains from another cluster can appear when node names overlap. This contradicts the plan’s drain isolation test. Files: `backend/nodemaintenance/store.go:60-200`, `backend/refresh/snapshot/node_maintenance.go:13-36`, `backend/resources/nodes/nodes.go:122-135`.

- Medium: Permission issues that trigger auth recovery have no cluster context, and auth recovery is guarded by a single global `authRecoveryScheduled` flag. This means a single cluster’s permission failure can block or trigger global recovery, not per-cluster. Files: `backend/refresh/system/manager.go:38-115`, `backend/app_refresh_recovery.go:131-167`.

- Low: `executeWithRetry` updates global transport/connection status on every fetch attempt; even if dependencies are per-cluster, this can still cause cross-cluster status bleed unless it is made per-cluster. File: `backend/fetch_helpers.go:204-258`.

- Low: Transport failure handling is global; failures from one cluster increment shared counters and can trigger a full `rebuildRefreshSubsystem`, tearing down all clusters. Files: `backend/fetch_helpers.go:248-255`, `backend/app_refresh_recovery.go:228-255`, `backend/app_refresh_recovery.go:191-206`.

- Low: Auth event payload shapes don’t match the frontend handler’s expectations. Backend emits a map with `clusterId`/`clusterName`/`reason`, but the handler expects a string `reason` in `args[0]`; even after fixing event names, the UI would not show cluster context without handler changes. Files: `backend/cluster_auth.go:43-72`, `frontend/src/hooks/useAuthErrorHandler.ts:45-62`.

- Low: The refresh HTTP server still anchors on a single `hostSubsystem` (first valid cluster) for mux/telemetry/registry wiring. This is effectively a “host” cluster even if not called “primary,” and the plan doesn’t address what happens if that host becomes invalid. Files: `backend/app_refresh_setup.go:71-231`.

- Low: The refresh mux is only built once with a `hostSubsystem`. Selection updates do not rebuild the mux, so if the host cluster is removed/teardown, the server remains bound to a stopped handler while aggregates update underneath. This conflicts with the “no primary” principle and can break refresh endpoints. Files: `backend/app_refresh_setup.go:180-275`, `backend/app_refresh_update.go:12-100`.

- Low: The refresh API registry comes from the `hostSubsystem`. Domain registration is permission-gated per cluster, so if the host lacks permissions, entire domains may be missing even when other clusters allow them. This is another implicit “primary” cluster dependency not addressed in the plan. Files: `backend/app_refresh_setup.go:199-231`, `backend/refresh/system/manager.go:97-120`.

- Low: Section 4 is accurate: the pods unhealthy filter key is global and will leak across clusters because it is not keyed by cluster id. File: `frontend/src/modules/namespace/components/podsFilterSignals.ts:9-20`.

## Notes / assumptions

- Additional concerns not explicitly called out in the plan:
  - Section 6 removal of global connection status/auth handling would regress current UI unless replaced with per-cluster connection-status events and state first (frontend still listens only to `connection-status` and `useAuthErrorHandler` tracks a single global flag). Files: `backend/app_connection_status.go:37-95`, `frontend/src/hooks/useWailsRuntimeEvents.ts:71-86`, `frontend/src/hooks/useAuthErrorHandler.ts:17-79`.
  - Section 1 scope is larger than the plan implies; many tests and helpers still depend on `app.client` / other globals, so the change impacts more files than listed (see `rg` results for `app.client` and related fields).
  - Section 2 per-cluster heartbeat should avoid calling shared `recordTransportFailure` / `updateConnectionStatus` unless those become per-cluster; otherwise cross-cluster bleed persists. Files: `backend/app_heartbeat.go:31-56`, `backend/app_refresh_recovery.go:217-255`.
  - Section 3/6 interplay: `rebuildRefreshSubsystem` is called by auth recovery and transport rebuild; removing it without per-cluster replacements will break recovery paths. Files: `backend/app_refresh_recovery.go:162-206`, `backend/app_refresh_recovery.go:258-284`.

- I did not validate runtime behavior; findings are based on static inspection of current code.
- Section 7 test criteria look reasonable, but I did not check whether tests already exist or pass.
