# Operation Lifecycle Registry Plan

Created: 2026-05-17
Status: Implemented

## Overview

Several user-facing workflows create live or long-running cluster-scoped work:

- Shell exec sessions and debug-container attach flows.
- Port-forward sessions with reconnect behavior.
- Node drain and maintenance jobs.

Each workflow has its own backend store, event names, frontend status handling,
and cluster cleanup logic. The target model is a small backend operation
lifecycle registry that gives cluster-scoped runtime work one cleanup and
visibility contract while preserving workflow-specific implementation details.

The desired end state is:

- Every live operation records cluster identity, operation type, stable ID, full
  target identity when it operates on a Kubernetes object, status, timestamps,
  and cleanup behavior.
- Cluster removal, kubeconfig clearing, auth/client teardown, and app shutdown
  call one backend cleanup path.
- Frontend status panels consume one runtime operation list contract for shell
  sessions, port forwards, and active drains, with workflow-specific events
  still available for high-frequency status/output details.
- Workflow-specific state, such as shell backlog, port-forward local ports, and
  drain events, remains owned by the workflow implementation.

## Non-Goals

- Do not collapse shell, port-forward, and node drain implementation into one
  generic runner.
- Do not close shell sessions when an object panel unmounts; current session
  continuity is intentional.
- Do not remove workflow-specific event streams such as shell output or
  port-forward status.
- Do not change Kubernetes operation behavior unless lifecycle tests prove a
  current bug.
- Do not move node drain history out of the `object-maintenance` refresh
  domain.

## Decisions

- Cluster lifecycle cleanup has one backend entrypoint. Cluster removal,
  kubeconfig clearing, client-pool teardown, explicit cluster-tab close, and app
  shutdown all call it.
- Cluster-tab close becomes an explicit backend command. The command performs
  active-operation discovery, stops runtime operations for the cluster, updates
  selected kubeconfigs, and emits the same runtime list events as other cleanup
  paths. The frontend may still ask for an active-operation count before showing
  a confirmation modal, but it must not directly orchestrate per-workflow
  cleanup.
- Shell sessions and port forwards are cleanup-owned runtime operations. Cluster
  cleanup closes them and removes them from the runtime operation list.
- Runtime operation target identity follows the app object-reference contract:
  concrete Kubernetes targets include `clusterId`, `group`, `version`, `kind`,
  `namespace` when namespaced, and `name`. The registry should not expose
  kind-only, name-only, or namespace/name-only target references.
- Active node drain jobs are registry-visible but keep their history and details
  in `object-maintenance`. Cluster cleanup cancels active drain jobs through an
  internal lifecycle cancellation path that does not perform user RBAC checks,
  records the terminal cancelled state in the drain store, and leaves completed
  and historical jobs available until the store's bounded history expires.
- The registry is backend runtime state, not refresh state or settings state.
  Its public list contract is a Wails runtime read plus a
  `runtime-operations:list` event. `object-shell:list` and `portforward:list`
  stay during the migration for workflow-specific consumers until parity tests
  prove they can be narrowed or removed.
- Drain progress remains refresh-backed through `object-maintenance`; the
  registry only exposes active drain presence for global status and cleanup.

## Inventory

Architecture and workflow docs:

- `docs/workflows/shell-debug.md`
- `docs/workflows/logs/overview.md`
- `docs/architecture/data-access.md`
- `.agents/skills/operations-workflows/SKILL.md`

Backend shell surfaces:

- `backend/shell_sessions.go`
- `backend/shell_sessions_test.go`
- `backend/shell_sessions_error_test.go`
- `backend/resources/pods/debug.go`

Backend port-forward surfaces:

- `backend/portforward.go`
- `backend/portforward_types.go`
- `backend/portforward_test.go`

Backend node-maintenance surfaces:

- `backend/nodemaintenance`
- `backend/resources_nodes.go`
- `backend/resources/nodes/nodes.go`
- `backend/refresh/snapshot/node_maintenance.go`
- `backend/resource_permission_test.go`

Cluster lifecycle cleanup callers:

- `backend/app_lifecycle.go`
- `backend/cluster_clients.go`
- `backend/kubeconfigs.go`
- `frontend/src/ui/layout/ClusterTabs.tsx`

Frontend runtime/session surfaces:

- `frontend/src/core/app-state-access/readers.ts`
- `frontend/src/modules/object-panel/components/ObjectPanel/Shell/ShellTab.tsx`
- `frontend/src/modules/port-forward`
- `frontend/src/ui/status/SessionsStatus.tsx`
- `frontend/src/shared/components/modals/DrainNodeModal.tsx`
- `frontend/src/shared/hooks/useNodeMaintenanceActions.tsx`

Current broadness:

- Backend cluster teardown calls shell and port-forward cleanup in at least
  three places.
- Frontend cluster tab close also coordinates shell and port-forward cleanup.
- App shutdown tears down auth managers, kubeconfig watching, and refresh state
  without currently going through the runtime operation cleanup path.
- Runtime session list reads are centralized through `appStateAccess`, but
  mutating operations and event contracts remain workflow-specific.
- `docs/workflows/shell-debug.md` references session-panel paths that are not
  present in the current frontend tree.

## Phases

- [x] Phase 1: Lifecycle contract tests
  - Add backend tests for the selected cleanup contract before adding the
    registry:
    - cluster removal stops shell sessions and port forwards through one cleanup
      helper;
    - app shutdown calls the same helper for every active cluster;
    - active drain jobs are cancelled through lifecycle cleanup, record a
      cancelled terminal state, and remain in bounded `object-maintenance`
      history;
    - completed drain jobs are not removed early by cluster cleanup.
  - Add tests for idempotent cleanup when the same cluster is removed through
    multiple paths, including repeated cluster-tab close and subsequent
    client-pool removal.
  - Add frontend tests that status surfaces remove operations after runtime list
    events and do not keep stale entries for the active cluster.

- [x] Phase 2: Backend registry shape
  - Introduce a small backend registry for cluster-scoped operations with:
    operation type, ID, cluster ID, optional full target object reference,
    status, started time, cleanup callback, and optional summary metadata for
    display.
  - Keep the registry separate from refresh state and app settings.
  - Register shell sessions, port-forward sessions, and drain jobs without
    changing their workflow-specific stores yet.
  - Add internal lifecycle cancellation support for active drain jobs so cleanup
    does not depend on a selected cluster client or user RBAC check after the
    cluster is already being removed.

- [x] Phase 3: Single backend cleanup entrypoint
  - Add a single backend cleanup function for removed clusters.
  - Replace repeated shell and port-forward cleanup calls in kubeconfig/client
    lifecycle code with the new entrypoint.
  - Wire `backend/app_lifecycle.go` shutdown through the same cleanup entrypoint.
  - Add the explicit backend close-cluster command used by cluster tabs. It
    should stop runtime operations, update selected kubeconfigs, and let the
    normal client-pool lifecycle observe an already-clean cluster without
    duplicating cleanup.

- [x] Phase 4: Unified runtime operation list
  - Add a `ListRuntimeOperations` runtime read and
    `runtime-operations:list` event backed by the registry.
  - Include shell sessions, port forwards, and active drain jobs in the runtime
    operation list.
  - Add parity tests proving `object-shell:list` and `portforward:list` remain
    consistent with the registry during migration.
  - Keep shell backlog and port-forward local port updates on their existing
    workflow APIs.
  - Keep drain details on `object-maintenance`, but connect active job presence
    to the registry.

- [x] Phase 5: Frontend status simplification
  - Update `SessionsStatus` to use the final runtime operation list for global
    counts, filtering, and removed-cluster cleanup.
  - Keep port-forward panels on port-forward workflow APIs where they need
    workflow-specific controls such as local port and reconnect status.
  - Update `ClusterTabs` to use the backend close-cluster command after the
    active-operation confirmation, not direct shell/port-forward stop calls.
  - Keep object-panel shell reattach behavior intact.
  - Keep active cluster filtering based on `clusterId`.
  - Add tests for cross-cluster shell jump, active cluster switch, and removed
    cluster cleanup.

- [x] Phase 6: Documentation and skill update
  - Update `docs/workflows/shell-debug.md` so referenced frontend paths match
    the current implementation.
  - Add an operation lifecycle section to the relevant workflow docs.
  - Update `.agents/skills/operations-workflows/SKILL.md` with the registry and
    cleanup checklist.

## Open Questions

- Should `runtime-operations:list` keep terminal operations for a short grace
  period for user-visible status transitions, or should it only list currently
  active operations?
- What minimal display metadata should active drain jobs expose in the runtime
  operation list without duplicating `object-maintenance` details?
- After frontend migration, can any public `object-shell:list` or
  `portforward:list` consumers be removed, or should they remain as stable
  workflow contracts?

## Validation Plan

- `go test ./backend ./backend/resources/pods ./backend/resources/nodes ./backend/nodemaintenance`
- `wails generate` after adding or changing Wails-exposed backend runtime
  operation commands/types.
- `npm run test --prefix frontend -- Shell port-forward SessionsStatus drain`
- `npm run typecheck --prefix frontend`
- Browser validation for shell/port-forward status behavior if frontend status
  surfaces change.
- `mage qc:prerelease`
- Inspect `git status --short` after the final gate because lint/fix steps may
  modify files.

## Progress Notes

- 2026-05-17: Plan created from app-review findings. No implementation started.
- 2026-05-17: Review fixes added explicit shutdown coverage, drain lifecycle
  semantics, backend-owned cluster-tab close, and the runtime operation list
  contract.
- 2026-05-18: Implemented runtime operation registry, backend cleanup entrypoint,
  close-cluster command, Wails bindings, runtime status UI migration, lifecycle
  docs, and focused backend/frontend tests.
