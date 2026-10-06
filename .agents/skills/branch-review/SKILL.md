---
name: branch-review
description: Review a Luxury Yacht branch for merge readiness, production readiness, PR-summary quality, or current-diff risk using read-only git state, repo contracts, and validation evidence
---

# Branch Review

Use this when the user asks whether a branch is production-ready, merge-ready,
an actual improvement, or asks for a branch/PR review or PR summary grounded in
the current diff. Stay in read-only review mode unless the user asks for fixes.

## Goal

Return a concrete merge-readiness verdict from the code, tests, and current
validation state. Findings lead; summaries are secondary. Answer whether the
work is complete, correct, safe to merge and release, and a real improvement
for users or the codebase, and whether anything important was missed.

## Scope the diff

1. Use `origin/main...HEAD` unless the user gives another base or range. If it
   cannot be resolved, inspect remotes and the default branch read-only and
   state the exact base assumption before reviewing.
2. Review committed and working-tree changes; do not skip modified, staged, or
   untracked files because the branch range is empty:

   ```sh
   git status --short && git branch --show-current
   git diff --stat origin/main...HEAD && git diff --name-only origin/main...HEAD
   git diff --stat && git diff --cached --stat
   git ls-files --others --exclude-standard
   ```

3. Changed docs or plans that claim completion are hints, not proof; inspect
   the contract paths the diff touches.

## Contract audit

Check every meaningful change against the root and scoped `AGENTS.md`
contracts already in context, then read the owning contract for each touched
area and verify its review points:

| Change area | Owning contract | Also verify |
| --- | --- | --- |
| Cross-layer contracts, generated bindings, enum/metadata drift | [shared-contracts](../../../docs/architecture/shared-contracts.md) | No parallel frontend/backend enum, descriptor, schema, or registry without a parity test |
| Multi-cluster, scopes, selected/background clusters, cache keys | [multi-cluster](../../../docs/architecture/multi-cluster.md), [cluster-auth-lifecycle](../cluster-auth-lifecycle/SKILL.md) | Auth, recovery, operations, streams, and cleanup stay scoped to the affected cluster |
| Auth failure, recovery, kubeconfig, client lifecycle | [auth](../../../docs/architecture/auth.md), [cluster-auth-lifecycle](../cluster-auth-lifecycle/SKILL.md) | |
| Refresh, snapshots, streams, diagnostics | [refresh-system](../../../docs/architecture/refresh-system.md), [data-layer](../../../docs/architecture/data-layer.md), [refresh-subsystem](../refresh-subsystem/SKILL.md) | Domain metadata, behavior classes, timing, backend/frontend registration, diagnostics, and tests align through the shared domain contract |
| Query-backed resource streams and WebSocket signals | [data-freshness](../../../docs/architecture/data-freshness.md), [data-layer](../../../docs/architecture/data-layer.md) | Stream messages stay liveness signals; rows, filtering, sorting, facets, totals, and page metadata stay on the HTTP query path; snapshots and signals agree on identity, scope, liveness, and permissions |
| Identity, status, lifecycle, links, facts, object refs | [shared-resource-model](../../../docs/architecture/shared-resource-model.md), [skill](../shared-resource-model/SKILL.md) | Primary status projects `status`, `statusState`, `statusPresentation`, and optional `statusReason`; relationship navigation uses `ResourceLink.ref` and catalog-backed identity, never frontend kind/name reconstruction |
| Kind vocabulary, generated dispatch, per-kind behavior | [resource-kind-registry](../../../docs/architecture/resource-kind-registry.md), [add-resource](../add-resource/SKILL.md) | |
| Browse, catalog, discovery, namespace metadata and LIST rows | [catalog](../../../docs/architecture/catalog.md), [refresh-system](../../../docs/architecture/refresh-system.md), [browse-tables](../browse-tables/SKILL.md) | |
| Frontend resource reads, app-state reads, stores | [data-access](../../../docs/architecture/data-access.md) | |
| Permissions, capabilities, RBAC UI | [permissions](../../../docs/architecture/permissions.md), [skill](../permissions-capabilities/SKILL.md) | Permission-denied and restricted-RBAC behavior stays visible in diagnostics |
| Tables, query-backed pages, large datasets | [gridtable](../../../docs/frontend/gridtable.md), [large-data](../../../docs/architecture/large-data.md) | |
| Object panel details, YAML, actions, docked panels | [object-panel](../object-panel/SKILL.md), [yaml-editing](../../../docs/architecture/yaml-editing.md), [yaml-editor](../../../docs/frontend/yaml-editor.md), [dockable-panels](../../../docs/frontend/dockable-panels.md) | YAML read/save/merge/ownership keeps full cluster and GVK identity and the shared field-policy contract |
| Logs, shell/debug, port-forward, drain, runtime operations | [operations-workflows](../operations-workflows/SKILL.md), [logs](../../../docs/workflows/logs/overview.md), [shell-debug](../../../docs/workflows/shell-debug.md), [operation-lifecycle](../../../docs/workflows/operation-lifecycle.md) | |
| Object map | [object-map skill](../object-map/SKILL.md), [object-map](../../../docs/workflows/object-map.md) | |
| UI shell, settings, modals, keyboard, tabs | [app-shell](../app-shell/SKILL.md), relevant `docs/frontend/*.md` | |

## Validation

Run focused checks first when the branch has clear areas:

- Backend shared, resource-model, or refresh changes: focused
  `mise exec -- go test` packages.
- Frontend changes: targeted Vitest specs and
  `mise exec -- npm run typecheck --prefix frontend`.
- Runtime operations (logs, shell, port-forward, drain): focused backend
  workflow tests plus affected frontend lifecycle/orchestrator tests.
- Broad frontend/shared changes: `mise exec -- wails3 task qc:knip`.

A "ready" verdict requires the root final gate plus `git diff --check` and
`git status --short` (documentation/comment-only branches may skip
`qc:prerelease`, not the other two). If the gate cannot run or fails, report the
exact command and first concrete failure and do not call the branch ready.

## Output

- Findings first, ordered by severity; each gives file/line, problem, impact,
  and concrete fix direction. Then open questions or assumptions, validation
  state, and a short verdict.
- No findings: say no merge-blocking issues were found, exactly what was
  validated, and the residual risk or untested areas.
- PR summaries: use the real diff/range; describe user-visible behavior and
  operational impact; omit touched-file inventories, commit hashes, and
  unverified claims.
