# Problems: 2025-01-30 Multi-Cluster Isolation Design

Reviewed on 2026-01-30.

## Duplicate / redundant work

- Section 5 and Section 8 are duplicate: both describe the same auth event name mismatch. This should be consolidated to avoid double-tracking.

- Section 3 (delete global `rebuildRefreshSubsystem`) and Section 6 (remove global auth/connection status) overlap in effect; both require rewriting the same recovery paths (auth recovery + transport rebuild). The plan treats them as separate deletions without sequencing, which is redundant and risks gaps if done twice.

- Section 1 list of global field removals partially overlaps with Section 3/6 changes; the same global state is referenced in multiple sections without a single owning migration step, leading to repeated edits in the same files.

## Validity / accuracy issues

- Section 5/8 fix is incomplete as written: the frontend handler expects `args[0]` to be a string reason, but the backend emits a map with `clusterId`, `clusterName`, and `reason`. Even after renaming events, the handler won’t show the right reason or cluster context without payload parsing changes.

- Section 6 recommends deleting `connection-status` and global connection state, but the current UI relies on `connection-status` events for the global banner and status indicator. Removing it without a per-cluster replacement would regress current UX.

- Section 2 (per-cluster heartbeat) is incomplete because transport failure handling and `updateConnectionStatus` are global; even if heartbeat loops per cluster, the shared failure counters and rebuild path can still tear down all clusters.

- Section 3’s “delete rebuildRefreshSubsystem” is unsafe as written because transport rebuild and auth recovery still call it. Removing it without new per-cluster rebuild hooks breaks recovery paths.

- Section 1 claims `listEndpointSlicesForService` should be deleted in favor of `listEndpointSlicesForServiceWithDependencies`, but `listEndpointSlicesForService` is used by the resource stream manager. The replacement is not wired there; deletion would break streams.

- Section 1’s file list is incomplete. Additional live uses of global `refreshManager`, `telemetryRecorder`, and informer factories exist outside the listed files; the scope of change is larger than the plan documents.

- Section 4 is accurate about the global pods filter key, but it omits other persistence that is already cluster-scoped (e.g., namespace grid table persistence), which could lead to inconsistent fixes if treated in isolation.

- Section 7 includes “Drain store test: Drain node in Cluster A → drain jobs list for Cluster B is empty,” but the current drain store is process-global and snapshots only filter by node name; cross-cluster bleed is possible when node names overlap. The plan doesn’t address that underlying data model.

- Section 2 suggests skipping heartbeat when auth is invalid “per auth manager,” but the current auth manager interface is per-cluster; the plan doesn’t specify how to access the correct auth manager while iterating cluster clients, and it doesn’t mention `authFailedOnInit` which is already used to skip subsystems.

- Section 6 says “Frontend displays status for active cluster tab only,” but there is no per-cluster connection status channel or state defined in the current frontend. This is more than deletion: it requires a new API/event contract.
