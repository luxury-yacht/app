# Cluster Open/Close Parallelization Plan

## Goal

Remove perceived UI hangs when opening/closing clusters in quick succession by parallelizing per-cluster initialization/shutdown, while preserving strict multi-cluster isolation and consistent shared state commits.

## Problem Summary

Today, cluster selection updates are fully serialized end-to-end:

- Frontend queues all selection changes in `KubeconfigContext` (`selectionQueueRef`).
- Backend `SetSelectedKubeconfigs` holds `kubeconfigChangeMu` across heavy operations (client creation, preflight checks, refresh subsystem updates, object catalog start).
- Per-cluster preflight (`Discovery().ServerVersion()`) can block on network/auth latency.
- Additional runtime mutation paths (`cluster_auth` recovery callbacks, kubeconfig watcher reload path, transport rebuild recovery) also take `kubeconfigChangeMu`.

Result: opening cluster B shortly after cluster A can appear to freeze because B waits for all of A’s work to finish.

## Scope

In scope:

- Parallelize cluster add/remove operations across distinct cluster IDs.
- Keep shared map/aggregate commits serialized and atomic.
- Preserve behavior and correctness for shell sessions, port-forwards, refresh domains, object catalog, and auth isolation.
- Add observability around selection operations and queue latency.

Out of scope:

- Changing cluster ID format or selection semantics.
- Changing auth-manager behavior or recovery policy.
- Reworking refresh domain definitions.

## Non-Negotiable Invariants

1. Multi-cluster isolation remains strict (no cross-cluster data/action bleed).
2. Shared state commits are transactional from the app perspective.
3. Stale work must never overwrite newer selection intent.
4. Removing a cluster must prevent further activity for that cluster after commit.
5. UI state remains responsive during long backend operations.

## Current Hotspots

1. Backend global lock (`kubeconfigChangeMu`) spans network-bound operations.
2. Runtime mutation entry points outside `SetSelectedKubeconfigs` can interleave with selection intent:
  - `rebuildClusterSubsystem`/`teardownClusterSubsystem` triggers in `cluster_auth.go`
  - `handleKubeconfigChange` watcher path in `kubeconfigs.go`
  - `runClusterTransportRebuild` in `app_refresh_recovery.go`
3. No explicit operation generation/version guarding final commit ordering.
4. No bounded (or intentionally uncapped) concurrency policy for large add/remove sets.

## Proposed Architecture

### 1. Two-Phase Selection Pipeline

Phase A: Intent + Diff (serialized, short lock)

- Normalize/validate requested selections.
- Compute diff against current committed selection:
  - `toAdd`, `toRemove`, `toKeep`
- Increment a monotonic `selectionGeneration`.
- Persist requested selection snapshot metadata needed for commit.
- Release global selection lock quickly.

Phase B: Per-Cluster Work (parallel, bounded)

- Run per-cluster jobs for `toAdd` and `toRemove` concurrently.
- Enforce one in-flight job per cluster ID (per-cluster lock/singleflight key).
- Use context cancellation tied to superseding generations.

Phase C: Commit (serialized, short lock)

- Reacquire lock.
- Verify generation is still current.
- Apply successful results with explicit commit semantics:
  - Build next-state maps/snapshots before lock acquisition.
  - Swap authoritative cluster state under lock in one critical section.
  - Update refresh aggregate handlers against that committed snapshot under the same commit phase.
  - If a commit-phase step fails, fail the generation commit and keep prior authoritative state.
- Discard stale/outdated results.
- Emit events and update refresh context.

### 1a. Mutation Entry Point Unification

All cluster runtime mutation entry points must pass through the same selection coordinator/generation gate:

- `SetSelectedKubeconfigs`
- kubeconfig watcher path (`handleKubeconfigChange`)
- auth recovery rebuild/teardown callbacks (`cluster_auth.go`)
- transport rebuild recovery (`runClusterTransportRebuild`)

No path may mutate cluster runtime state without participating in generation ordering checks.

### 2. Per-Cluster Operation Coordinator

Introduce coordinator responsible for:

- Per-cluster mutual exclusion.
- Configurable concurrency policy with default `min(batchSize, configuredCap)` and high enough cap for I/O-bound preflight/startup.
- Cancellation of stale generation work.
- Collecting per-cluster success/failure results for commit step.

### 3. Generation Safety

Every selection request gets `generation`.

- Worker results are tagged with generation.
- Commit only applies results for current generation.
- Older generation completions are ignored.

### 4. Locking Strategy

Keep locks narrow and purpose-specific:

- `selection lock`: only for selection snapshot + generation updates + final commit.
- `clusterClientsMu`: map mutation only.
- refresh/catalog commit lock(s): only aggregate pointer swap and lifecycle map updates.

No long-running network calls under global selection lock.

### 5. Timeout and Cancellation Policy

Per-cluster add/remove operations must run with explicit timeouts:

- Client/preflight timeouts to avoid indefinite stalls.
- Refresh/catalog startup/shutdown deadlines.
- Cancellation when superseded by new generation.

### 6. Frontend Scheduling Changes

Keep current frontend queue behavior initially. Treat coalescing as optional and data-driven:

- Preserve optimistic UI update and current Promise chaining semantics.
- Measure queue wait contribution in Phase 0 before changing scheduling behavior.
- Only introduce latest-intent coalescing if instrumentation shows frontend queue latency is a meaningful bottleneck.
- Ensure active-tab switching remains instant (`setActiveKubeconfig` is local-state only).

## Data/Control Flow (Target)

1. User selection change arrives.
2. Frontend sends intent through current queue semantics.
3. Backend records generation + diff under short lock.
4. Coordinator executes per-cluster add/remove jobs in parallel.
5. Backend commits current generation atomically.
6. Frontend receives completion/event and refresh context updates.

## Failure Model

Partial failures are cluster-scoped:

- Failed `toAdd` cluster remains unavailable; does not block unrelated clusters.
- Failed `toRemove` logs warning and retries/best-effort cleanup path.
- Commit applies successful clusters only, with explicit error reporting.
- No rollback to previous full selection unless explicitly required by product decision.

## Observability and Diagnostics

Add metrics/logs for:

- Selection request enqueue time and total duration.
- Time spent in each phase (diff/work/commit).
- Per-cluster job latency and outcome.
- Generation superseded/cancelled counts.
- Queue depth and coalesced request count.

Diagnostics panel should reflect transition status without ambiguous “hung” state.

## Phased Rollout

## Phase 0: Baseline Instrumentation

- [ ] Add timing/log instrumentation around current selection path.
- [ ] Capture baseline p50/p95 open/close latency and queue wait.
- [ ] Add regression reproduction scenario in tests.

## Phase 1: Backend Refactor (No Behavior Change Yet)

- [ ] Split `SetSelectedKubeconfigs` into intent/diff + execution + commit stages.
- [ ] Narrow lock scope to state transitions only.
- [ ] Introduce generation token plumbing.
- [ ] Route watcher/auth-recovery/transport-recovery mutation paths through generation-aware coordinator boundaries.
- [ ] Document and enforce lock ordering (`kubeconfigChangeMu` and downstream locks) in code comments/tests.
- [ ] Fix `clearKubeconfigSelection` to shut down existing auth managers before clearing cluster client state.
- [ ] Keep execution still sequential initially for safer validation.

## Phase 2: Per-Cluster Parallel Execution

- [ ] Add per-cluster coordinator with bounded concurrency.
- [ ] Enforce one in-flight operation per cluster ID.
- [ ] Add cancellation for superseded generations.
- [ ] Add explicit operation timeouts.

## Phase 3: Optional Frontend Coalescing (Conditional)

- [ ] Gate this phase on Phase 0 evidence that frontend queue wait materially contributes to latency.
- [ ] If needed, replace strict queue with latest-intent coalescing.
- [ ] Preserve deterministic Promise resolution and optimistic UI semantics.

## Phase 4: Hardening

- [ ] Expand integration tests for rapid open/close/open sequences.
- [ ] Run race detector for backend selection paths.
- [ ] Validate object catalog/refresh/shell/port-forward behavior under churn.
- [ ] Verify no cross-cluster contamination in cached state.

## Test Plan

Backend:

- Unit tests for diff correctness and generation handling.
- Concurrency tests for:
  - rapid add/remove across different clusters
  - add/remove same cluster races
  - superseded generation discard
- `go test -race` focused on kubeconfig/refresh/client pools.

Frontend:

- Context tests for current queue behavior and optimistic state consistency.
- Coalescing behavior tests only if Phase 3 is enabled.
- Rapid selection change tests ensuring UI remains interactive.
- No regressions in cluster tab behavior and command palette kubeconfig actions.

End-to-end scenarios:

1. Open A, immediately open B, then C.
2. Open A, close A while opening B.
3. Open A+B, quickly deselect/reselect B.
4. Auth-failed cluster added while healthy cluster operations continue.

## Backward Compatibility

- Wails API signatures remain unchanged in this phase.
- Existing events remain; add optional diagnostic metadata only.
- No changes to cluster identity format (`filename:context`).

## Risks and Mitigations

Risk: stale operation commits overwrite newer intent.

- Mitigation: strict generation check at commit.

Risk: deadlocks from new lock ordering.

- Mitigation: define lock ordering explicitly and enforce in code review/tests.

Risk: non-selection mutation paths bypass generation checks.

- Mitigation: force watcher/auth/transport mutation paths through coordinator boundary.

Risk: resource leaks on canceled operations.

- Mitigation: context-driven cleanup and shutdown deadlines.

Risk: partial failure leaves confusing UI.

- Mitigation: cluster-scoped status events and clear diagnostics.

## Acceptance Criteria

1. Opening/closing different clusters no longer blocks each other end-to-end.
2. Rapid tab open/close keeps UI responsive (no visible freeze).
3. Shared state remains consistent with latest selection intent.
4. All frontend and backend test suites pass, including race checks for touched backend packages.
5. No multi-cluster isolation regressions.

## Files Expected to Change (Implementation Phase)

Backend (expected):

- `backend/kubeconfigs.go`
- `backend/cluster_clients.go`
- `backend/cluster_auth.go`
- `backend/app_refresh_recovery.go`
- `backend/app_refresh_update.go`
- new coordinator file(s), e.g. `backend/kubeconfig_selection_coordinator.go`
- tests around kubeconfig selection/update flow

Frontend (expected):

- `frontend/src/modules/kubernetes/config/KubeconfigContext.tsx`
- corresponding tests in `KubeconfigContext.test.tsx`

## Resolved Design Decisions

1. Partial add failures: keep clusters selected and surface cluster-scoped error status.
2. Concurrency policy: configurable with default effectively scaled to batch size (not fixed low cap).
3. Commit semantics: partial success per cluster, no strict full-generation rollback by default.
4. Same-cluster conflict policy: latest intent wins by generation ordering with cancel-on-supersede.
