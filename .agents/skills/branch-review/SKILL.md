---
name: branch-review
description: Review a Luxury Yacht branch for merge readiness, production readiness, PR-summary quality, or current-diff risk using read-only git state, repo contracts, and validation evidence
---

# Branch Review

Use this when the user asks whether a branch is production-ready, merge-ready,
an actual improvement, or asks for a branch/PR review or PR summary grounded in
the current diff.

## Goal

Return a concrete merge-readiness verdict based on the code, tests, and current
validation state. Findings lead. Summaries are secondary.

What the user wants to know:

- Is the work COMPLETE?
- Is the work CORRECT?
- Is the work SAFE to merge and release?
- Is the work a REAL improvement, either for the user experience or the codebase?
- Was anything important missed that should have been included?

## Read-Only First Pass

Unless the user explicitly asks for fixes, begin in review mode.

1. Read `AGENTS.md`, `backend/AGENTS.md`, and `frontend/AGENTS.md`.
2. Read `.agents/README.md`, `docs/README.md`, and
   `.agents/context/code-map.md`.
3. Read `.agents/context/app-areas.md` when the branch is broad, ambiguous, or
   crosses multiple user-facing workflows.
4. Check repository state with read-only git commands:
   - `git status --short`
   - `git branch --show-current`
   - `git diff --stat origin/main...HEAD`
   - `git diff --name-only origin/main...HEAD`
   - `git diff --stat`
   - `git diff --name-only`
   - `git diff --cached --stat`
   - `git diff --cached --name-only`
   - `git ls-files --others --exclude-standard`
5. If the user provides a different base or range, use that instead of
   `origin/main...HEAD`.
6. If `origin/main...HEAD` cannot be resolved, inspect remotes/default branch
   state with read-only git commands and state the exact base assumption before
   reviewing.
7. Review both committed branch changes and working-tree changes. Do not ignore
   modified, staged, or untracked files just because `origin/main...HEAD` is
   empty.
8. Read any changed docs/plans that claim completion. Treat them as hints, not
   proof.

## Contract Audit

For every meaningful change, inspect the owning contract:

| Change Area                                                           | Required Context                                                                                                                                            |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cross-layer shared contracts, generated bindings, enum/metadata drift | `docs/architecture/shared-contracts.md`                                                                                                                     |
| Multi-cluster, scopes, selected/background clusters, cache keys       | `docs/architecture/multi-cluster.md`, `.agents/skills/cluster-auth-lifecycle/SKILL.md`                                                                      |
| Auth failure, recovery, kubeconfig, client lifecycle                  | `docs/architecture/auth.md`, `.agents/skills/cluster-auth-lifecycle/SKILL.md`                                                                               |
| Refresh, snapshots, streams, diagnostics                              | `docs/architecture/refresh-system.md`, `docs/architecture/data-layer.md`, `.agents/skills/refresh-subsystem/SKILL.md`                                       |
| Query-backed resource streams and resource WebSocket signals          | `docs/architecture/resource-stream-signals.md`, `docs/architecture/data-layer.md`                                                                           |
| Identity, status, lifecycle, links, facts, object refs                | `docs/architecture/shared-resource-model.md`, `.agents/skills/shared-resource-model/SKILL.md`                                                               |
| Resource kind vocabulary, generated dispatch, per-kind behavior       | `docs/architecture/resource-kind-registry.md`, `.agents/skills/add-resource/SKILL.md`                                                                       |
| Browse/catalog/discovery/namespaces                                   | `docs/architecture/catalog.md`, `.agents/skills/browse-tables/SKILL.md`                                                                                     |
| Frontend resource reads, app-state reads, stores                      | `docs/architecture/data-access.md`                                                                                                                          |
| Permissions/capabilities/RBAC UI                                      | `docs/architecture/permissions.md`, `.agents/skills/permissions-capabilities/SKILL.md`                                                                      |
| Tables, query-backed pages, large datasets                            | `docs/frontend/gridtable.md`, `docs/architecture/large-data.md`                                                                                             |
| Object panel details, YAML, actions, docked panels                    | `.agents/skills/object-panel/SKILL.md`, `docs/architecture/yaml-editing.md`, `docs/frontend/yaml-editor.md`, `docs/frontend/dockable-panels.md`             |
| Logs, shell/debug, port-forward, drain, runtime operations            | `.agents/skills/operations-workflows/SKILL.md`, `docs/workflows/logs/overview.md`, `docs/workflows/shell-debug.md`, `docs/workflows/operation-lifecycle.md` |
| Object map                                                            | `.agents/skills/object-map/SKILL.md`, `docs/workflows/object-map.md`                                                                                        |
| UI shell/settings/modals/keyboard/tabs                                | `.agents/skills/app-shell/SKILL.md`, relevant `docs/frontend/*.md`                                                                                          |

## Required Checks

Look for these before considering the branch ready:

- Every review claim cites evidence gathered in the current turn (`file:line` or
  command output) or is explicitly marked `[unverified]` / `[assumed]`.
- Cluster-data paths carry `clusterId` through requests, scopes, caches, state,
  events, navigation, persistence keys, and actions.
- Object references crossing boundaries carry `clusterId`, `group`, `version`,
  `kind`, and concrete `namespace`/`name` when applicable.
- Object catalog remains the source of truth for discovery, existence,
  GVK/GVR identity, browse, namespace listings, and cluster listings.
- Backend status semantics are projected as `status`, `statusState`,
  `statusPresentation`, and optional `statusReason` where primary status is
  rendered.
- Relationship navigation uses `ResourceLink.ref` and catalog-backed identity,
  not frontend kind/name reconstruction.
- List/table payloads are served from refresh snapshot/query paths, not
  `backend/resources` detail/action services.
- Refresh domain metadata, behavior classes, timing, backend registrations,
  frontend registrations, diagnostics, and tests align through the shared domain
  contract.
- Query-backed resource stream WebSocket messages remain liveness signals; rows,
  filtering, sorting, facets, totals, and page metadata stay on the HTTP
  snapshot/query path.
- Snapshot/query payloads and stream signals agree on identity, scope, liveness,
  and permission behavior for the same table/list surface.
- Permission-denied or restricted-RBAC behavior remains visible in diagnostics.
- Auth, recovery, runtime operation, stream, and cleanup behavior stays scoped to
  the affected cluster.
- YAML read/save/merge/ownership flows preserve full cluster and GVK identity and
  the shared field-policy contract.
- Shared contracts do not add parallel frontend/backend enums, descriptors,
  schemas, or registries without parity tests.
- Frontend resource reads use `dataAccess`, app-shell/persisted-state reads use
  `appStateAccess`, and direct `fetch` remains confined to the refresh client.
- New frontend UI uses existing components, CSS files, tokens, aliases, and
  GridTable where applicable.
- Tests cover the changed behavior at the closest useful level.

## Validation Sequence

Run focused tests first when the branch has clear areas:

- Backend shared/resource-model/refresh changes: focused `go test` packages.
- Frontend changes: targeted Vitest specs and `npm run typecheck --prefix frontend`.
- Runtime operations/logs/shell/port-forward/drain: focused backend workflow
  tests plus affected frontend lifecycle/orchestrator tests.
- Broad frontend/shared changes: consider `mage qc:knip`.

Before a final "ready" verdict on non-documentation or non-comment-only work,
run:

```sh
mage qc:prerelease
git diff --check
git status --short
```

If `mage qc:prerelease` cannot run or fails, report the exact command and first
concrete failure. Do not call the branch ready.

`mage qc:prerelease` includes `lint:fix`, so inspect changed files afterward.

For documentation-only or comment-only branches, `mage qc:prerelease` may be
skipped, but still run `git diff --check` and `git status --short` before the
verdict.

## Output Format

For review findings:

1. Findings first, ordered by severity.
2. Each finding includes file/line, problem, impact, and concrete fix direction.
3. Then open questions or assumptions.
4. Then validation state.
5. Then short summary/verdict.

For no findings:

- Say that no merge-blocking issues were found.
- State exactly what was validated.
- State residual risk or untested areas.

For PR summaries:

- Use the real diff/range.
- Describe user-visible behavior and operational impact.
- Avoid touched-file inventories, commit hashes, and unverified claims.
