# Durable Agent Lessons

This file stores repo-specific agent lessons that should remain useful across
sessions. Keep it short, durable, and tied to code contracts.

## Branch Reviews

- A checked plan is not enough evidence that a branch is merge-ready. Inspect
  the actual contract paths touched by the diff.
- Start with `origin/main...HEAD` unless the user gives a different base.
- For merge-readiness, report blockers first, then validation state, then a
  brief summary.
- `mage qc:prerelease` is the final gate for non-documentation work. It runs
  frontend lint fix, so inspect the worktree afterward.
- Consider `mage qc:knip` for broad frontend/shared-surface changes even when
  another targeted frontend check passed.

## Identity And Resource Contracts

- Prefer strict object identity helpers and backend-provided references over
  frontend reconstruction.
- Do not turn kind-only, name-only, or namespace/name-only values into object
  references across module, API, cache, action, event, or navigation
  boundaries.
- Frontend status styling should consume backend `statusPresentation`; missing
  presentation should stay visible as `unknown` during tests.
- Relationship navigation should use backend-provided `ResourceLink.ref` and
  catalog-backed resolution.

## Refresh And Data Flow

- Refresh list/table data belongs in `backend/refresh/snapshot`. Rich details,
  logs, and imperative operations belong in `backend/resources`.
- Backend domain registration, permission gates, frontend domain types,
  refresher config, orchestrator registration, and diagnostics mappings must be
  kept in sync.
- Snapshot rows and stream rows for the same resource surface must stay shape
  compatible.
- Refresh domains are single-cluster only. Multi-cluster/background refresh
  should fan out across per-cluster runtimes instead of using one multi-cluster
  refresh scope.
- `namespaces` and `cluster-overview` are ordinary per-cluster domains. Do not
  add aggregate-domain exceptions for them; derive cross-cluster displays from
  multiple per-cluster entries above refresh state.
- Backend aggregate refresh handlers are muxes, not merge engines. Snapshot,
  manual refresh, event stream, and resource stream requests should route to
  exactly one scoped cluster and reject multi-cluster selectors.
- Frontend resource stream descriptors own row identity, sorting, drift keys,
  row collections, and metric preservation. Backend resource stream supported
  domains live in `backend/refresh/resourcestream/domains.go`; keep both aligned
  with refresh domain registration.
- Keep resource stream connection lifecycle, subscription state, pure row
  merge math, and manager-owned resync/drift/store mutation in their dedicated
  modules. A descriptor table should not hide pods, endpoint slices, workloads,
  custom resources, node-derived updates, or Helm resync behavior.
- Multi-cluster behavior must be checked at scope keys, caches, requests,
  stores, and UI state reset boundaries.

## Object Map

- Object map is a scoped refresh snapshot domain named `object-map`.
- For missing resource kinds or graph data, inspect backend snapshot collection
  and edge construction before frontend allowlists or renderer styling.
- Add object-map support backend first when the issue is graph/data correctness.
- Frontend card metadata must be threaded through payload types, model state,
  visible state, layout/rendering, apply-queue equality, palette/styling, and
  tests together.
- For Gateway API fake-client tests, explicit list reactors may be needed; use
  `gatewayfake.NewClientset()` rather than deprecated constructors.

## Other High-Value Areas

- Object panel work often crosses rich detail DTOs, YAML read/apply paths,
  logs/shell streams, object actions, docked panel state, and frontend type
  bindings. Identify the specific tab/workflow before editing.
- Cluster and namespace views are primary surfaces. Treat refresh payload shape,
  table behavior, selected cluster/namespace context, and large-data behavior as
  first-class contracts.
- Logs, shell, port-forward, and drain workflows combine long-running backend
  operations with frontend lifecycle and cleanup. Check cancellation, teardown,
  permissions, and cluster identity together.
- Settings, command palette, sidebar, shortcuts, and modals are global app-shell
  systems. Keep labels, icons, persistence, focus, and drag behavior aligned
  across surfaces.

## Wails Bindings

- When Go DTOs change, generated frontend bindings may need refresh. If
  automated generation is unreliable in the local environment, manually verify
  `frontend/wailsjs/go/models.ts` against the Go shape and run frontend
  typecheck.
