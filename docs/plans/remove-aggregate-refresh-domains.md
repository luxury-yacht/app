# Remove Aggregate Refresh Domains Plan

## Overview

The refresh-streaming simplification removed multi-cluster resource stream
domains, but it intentionally left aggregate snapshot domains in place. That is
now the wrong model. The app can have multiple clusters open, but refresh
domains should be single-cluster by construction. Any cross-cluster display
should be derived above refresh state from per-cluster domain results.

This plan removes the remaining aggregate refresh-domain model from the
frontend and removes backend snapshot merge support that accepts
`clusters=...|...` scopes.

## Current State

Completed work from `docs/plans/refresh-streaming-simplification.md` already:

- Resource WebSocket domains reject multi-cluster scopes on the frontend and
  backend.
- Background refresh fans out as separate per-cluster resource refreshes.
- Resource stream descriptors no longer include multi-cluster capability flags.
- Cluster-scoped resource streams use single-cluster scope keys.

Remaining aggregate behavior:

- `frontend/src/core/refresh/orchestrator.ts` still declares
  `namespaces` and `cluster-overview` as aggregate domains.
- `frontend/src/modules/namespace/contexts/NamespaceContext.tsx` still builds
  one `namespaces` scope from every selected cluster ID.
- Diagnostics still has tests that preserve a multi-cluster `namespaces` row.
- `backend/refresh_aggregate_snapshot.go` still accepts multi-cluster snapshot
  scopes for most domains and merges the results.
- `backend/refresh/snapshot/merge.go` still contains domain-specific snapshot
  merge functions.

## Target Model

- Every refresh domain scope targets exactly one cluster.
- The frontend refresh orchestrator has no aggregate-domain exception list.
- The coordinator remains only for app lifecycle concerns; cluster data lives
  in per-cluster runtimes.
- Namespace state is stored per cluster. The active namespace list is derived
  from the active cluster's `namespaces` state.
- Cluster overview state is stored per cluster. Any future all-cluster summary
  is derived from per-cluster `cluster-overview` states.
- Backend snapshot HTTP handling routes one cluster-scoped request to one
  per-cluster snapshot service.
- Backend snapshot requests using `clusters=...|...` with more than one cluster
  are rejected.

## Non-Goals

- Do not remove multi-cluster UI concepts such as multiple open cluster tabs.
- Do not remove background refresh.
- Do not remove the aggregate mux layer entirely; it still routes frontend HTTP
  requests to the selected per-cluster subsystem.
- Do not change resource stream behavior beyond deleting now-dead aggregate
  assumptions.
- Do not rewrite namespace selection UX unless required by per-cluster state.

## Phase 1: Frontend Domain Ownership

- [ ] Remove `AGGREGATE_SCOPE_DOMAINS` from
      `frontend/src/core/refresh/orchestrator.ts`.
- [ ] Remove `normalizeAggregateScope()` or make it unnecessary.
- [ ] Ensure `namespaces` and `cluster-overview` normalize through the same
      single-cluster path as other non-resource-stream domains.
- [ ] Ensure `getRuntimeForScope()` routes all cluster-scoped domain state to a
      `ClusterRefreshRuntime`.
- [ ] Keep the coordinator runtime only for non-cluster lifecycle state, if any
      remains.
- [ ] Update orchestrator tests that currently assert aggregate-domain
      behavior.

Notes:

- `cluster-overview` currently appears to use single-cluster scopes in live UI
  code, but it still has an aggregate exception in the orchestrator. Remove the
  exception and keep the current single-cluster caller behavior.
- `namespaces` is the live frontend producer of multi-cluster refresh scopes
  and needs the larger change.

## Phase 2: Namespace State Per Cluster

- [ ] Change `NamespaceContext` to read namespace data from the active
      cluster's `namespaces` scope.
- [ ] Enable `namespaces` refresh for each open cluster that needs namespace
      data instead of one `clusters=...|` scope.
- [ ] Keep namespace selection per cluster tab.
- [ ] Keep the active namespace list filtered by active cluster, but derive it
      from that cluster's namespace payload rather than from an aggregate
      payload.
- [ ] Ensure background cluster namespace refresh still works when background
      refresh is enabled.
- [ ] Update `NamespaceContext` tests to expect per-cluster namespace state.

Implementation direction:

- Build active scope with `buildClusterScope(selectedClusterId, '')`.
- For background/open clusters, fan out via explicit per-cluster enable/fetch
  calls instead of `buildClusterScopeList(selectedClusterIds, '')`.
- Avoid a new aggregate namespace store. If a UI needs all namespaces across
  clusters later, derive it by reading per-cluster scoped entries.

## Phase 3: Diagnostics And App Debug Surfaces

- [ ] Update diagnostics refresh-domain rows to show separate per-cluster
      `namespaces` entries.
- [ ] Remove diagnostics tests that preserve multi-cluster namespace or overview
      rows.
- [ ] Add diagnostics tests proving active/background cluster scopes are visible
      as separate rows.
- [ ] Check Application Logs wording for stale references to aggregate
      namespaces or `clusterId=all`.
- [ ] Check refresh docs/debug notes for `clusters=...` snapshot scope examples
      that are no longer valid.

Expected diagnostics result:

- No refresh-domain row should display `clusters=id1,id2|...`.
- A multi-cluster session may show multiple `namespaces` rows, one per cluster.
- Resource stream diagnostics remain unchanged except for any cleanup from
  removed aggregate helpers.

## Phase 4: Backend Single-Cluster Snapshot Routing

- [ ] Change `backend/refresh_aggregate_snapshot.go` so snapshot requests must
      resolve to exactly one cluster.
- [ ] Reject scopes whose cluster selector contains more than one cluster.
- [ ] Keep missing/unavailable cluster handling for single-cluster requests.
- [ ] Update aggregate snapshot tests that currently assert partial
      multi-cluster merge behavior.
- [ ] Update aggregate manual queue behavior and tests to reject multi-cluster
      snapshot scopes instead of splitting them.

Important distinction:

- The backend aggregate layer can remain as a mux across per-cluster services.
- The aggregate layer should no longer be a merge engine for one request that
  targets multiple clusters.

## Phase 5: Delete Snapshot Merge Code

- [ ] Remove `backend/refresh/snapshot/merge.go` once no production path calls
      `snapshot.MergeSnapshots`.
- [ ] Remove merge-specific tests from `backend/refresh/snapshot/merge_test.go`.
- [ ] Remove any helper code that only exists for aggregate snapshot merging.
- [ ] Keep row-level merge helpers used by frontend resource stream updates;
      those are unrelated to backend aggregate snapshots.
- [ ] Run a repo-wide search for `MergeSnapshots`, `clusters=`, and
      `buildClusterScopeList` to confirm no unsupported production path
      remains.

## Phase 6: Documentation And Agent Notes

- [ ] Update `docs/architecture/refresh-system.md` to state that refresh
      domains are single-cluster only.
- [ ] Update `docs/architecture/multi-cluster.md` to remove multi-cluster
      refresh-domain scope guidance.
- [ ] Update `.agents/skills/refresh-subsystem/SKILL.md`.
- [ ] Update `.agents/skills/add-resource/SKILL.md` if it still mentions
      aggregate domain behavior.
- [ ] Update `.agents/context/code-map.md` and `.agents/context/lessons.md` if
      their refresh notes mention aggregate snapshot domains.
- [ ] Update this plan with completed progress as each phase lands.

## Validation

Targeted checks during implementation:

```bash
npm run test -- src/core/refresh/orchestrator.test.ts
npm run test -- src/modules/namespace/contexts/NamespaceContext.test.tsx
npm run test -- src/core/refresh/components/DiagnosticsPanel.test.ts
go test ./backend ./backend/refresh ./backend/refresh/snapshot
```

Before marking code work complete:

```bash
mage qc:prerelease
```

After `mage qc:prerelease`, inspect the worktree because the gate can run
frontend lint fixes.

## Open Questions

No product questions are currently blocking this. The working decision is:

- No refresh domain should use a multi-cluster scope.
- Cross-cluster UI data should be derived above refresh state.
- Backend snapshot merge support should be removed after the frontend no longer
  produces aggregate scopes.
