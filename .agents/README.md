# Agent Task Router

Use this file before large or cross-layer tasks. It points agents to the
smallest useful context set for common Luxury Yacht work.

## Always Start Here

1. Read the root `AGENTS.md`.
2. Read `backend/AGENTS.md` before changing Go/backend code.
3. Read `frontend/AGENTS.md` before changing React/TypeScript/frontend code.
4. Use `docs/README.md` to find the owning architecture or workflow contract.
5. Check `.agents/context/code-map.md` for code entrypoints.
6. Check `.agents/context/app-areas.md` when the task is broad, ambiguous, or
   could cross multiple user-facing systems.
7. For non-documentation work, finish with the latest code validated by
   `mage qc:prerelease` unless the task explicitly does not allow it.

## Task Routing

| Request                                                                    | First skill/doc                                                                    | First code paths                                                                                          | Validation                                                                      |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Large-scale structural review for simplification, hardening, optimization, or refactoring across broad systems or cross-cutting concerns | `.agents/skills/app-review/SKILL.md`, `.agents/context/app-areas.md`               | Cross-cutting inventories first, then owning docs/contracts and system entrypoints                         | Usually read-only; plan docs use `git diff --check`; implementation uses `mage qc:prerelease` |
| "Is this branch production-ready?" or "ready to merge?"                    | `.agents/skills/branch-review/SKILL.md`                                            | `git diff origin/main...HEAD`, changed contract paths                                                     | Targeted tests, `mage qc:prerelease`, `git diff --check`                        |
| "Write a PR summary"                                                       | Branch-review workflow for context                                                 | `git diff origin/main...HEAD`, changed user-facing paths                                                  | Usually read-only unless requested otherwise                                    |
| "Add support for resource X"                                               | `.agents/skills/add-resource/SKILL.md`                                             | `backend/resourcemodel`, `backend/refresh/snapshot`, `backend/resources`, object-panel/frontend consumers | Targeted backend/frontend tests, `mage qc:prerelease`                           |
| Refresh, stream, snapshot, diagnostics, or domain changes                  | `.agents/skills/refresh-subsystem/SKILL.md`, `docs/architecture/refresh-system.md` | `backend/refresh/system`, `backend/refresh/snapshot`, `frontend/src/core/refresh`                         | Domain-specific backend/frontend tests, diagnostics check, `mage qc:prerelease` |
| Object identity, status, links, facts, lifecycle, or relationship behavior | `.agents/skills/shared-resource-model/SKILL.md`, `docs/architecture/shared-resource-model.md` | `backend/resourcemodel`, `backend/refresh/snapshot`, frontend status/link utilities                       | Parity tests across changed surfaces, `mage qc:prerelease`                      |
| Catalog, browse, cluster/namespace views, tables, or object existence      | `.agents/skills/browse-tables/SKILL.md`, `docs/architecture/catalog.md`            | `backend/objectcatalog`, `backend/refresh/snapshot/catalog.go`, browse/cluster/namespace modules          | Catalog/objectcatalog tests, relevant frontend tests                            |
| Object panel details, YAML, actions, or docked panels                      | `.agents/skills/object-panel/SKILL.md`, `docs/frontend/dockable-panels.md`         | `frontend/src/modules/object-panel`, `backend/resources`, object detail/YAML/action backends              | Targeted backend/frontend tests, typecheck, `mage qc:prerelease`                |
| Logs, shell exec, debug containers, port-forward, drain, or node logs      | `.agents/skills/operations-workflows/SKILL.md`, relevant workflow docs             | backend operation/session streams, runtime registry, object-maintenance refresh, object-panel workflow UI, port-forward UI | Workflow-specific tests, refresh/orchestrator tests, manual/browser validation when needed |
| Settings, command palette, sidebar, shortcuts, modals, or app shell        | `.agents/skills/app-shell/SKILL.md`, `docs/architecture/data-access.md`, relevant `docs/frontend/*.md` | `backend/app_settings.go`, `frontend/src/core/settings`, `frontend/src/core/app-state-access`, `frontend/src/ui` | Targeted Vitest/typecheck, browser/story validation for visual changes          |
| Auth failures, kubeconfig, cluster selection, or multi-cluster behavior    | `.agents/skills/cluster-auth-lifecycle/SKILL.md`, `docs/architecture/auth.md`      | backend client/auth setup, frontend connection/cluster contexts                                           | Multi-cluster/restricted-auth checks, targeted tests                            |
| Permissions, capabilities, RBAC gating, or action availability             | `.agents/skills/permissions-capabilities/SKILL.md`, `docs/architecture/permissions.md` | backend capability/permission services, frontend capability hooks and actions                             | Allowed/denied/error tests, diagnostics checks                                  |
| Port-forward, maintenance, drain, or imperative workflows                  | `.agents/skills/operations-workflows/SKILL.md`, `docs/architecture/permissions.md` | backend operation services, frontend workflow modules                                                     | Operation-specific tests, permission/capability checks                          |
| Object map data, missing kinds, graph links, legend, or G6 behavior        | `.agents/skills/object-map/SKILL.md`, `docs/workflows/object-map.md`               | `backend/refresh/snapshot/object_map.go`, `frontend/src/modules/object-map`, object-panel support         | Object-map backend tests, targeted Vitest, `mage qc:prerelease`                 |
| Frontend placement, shared UI, app shell, or module structure              | `docs/frontend/component-structure.md`                                             | `frontend/src/core`, `modules`, `shared`, `ui`                                                            | Targeted Vitest/typecheck; browser/story validation for visual changes          |
| New Storybook story                                                        | `.agents/skills/new-story/SKILL.md`                                                | Component plus all hook/provider dependencies                                                             | `npm run typecheck --prefix frontend` or equivalent                             |
| Release notes                                                              | `.agents/skills/draft-release-notes/SKILL.md`                                      | Git log range, `docs/release/pending.md`                                                                  | Usually no prerelease for doc-only output                                       |

## Cross-Cutting Checks

- Cluster data must carry `clusterId` through data access, caches, actions,
  refresh scopes, events, navigation, and persistence keys.
- Object references crossing boundaries must include `clusterId`, `group`,
  `version`, and `kind`; concrete objects also need `namespace` and `name`.
- Backend `statusPresentation` and `ResourceLink.ref` are authoritative for
  primary status and relationship navigation.
- Use the object catalog for identity, discovery, browse, namespace listings,
  and cluster listings.
- Add list/table payloads to `backend/refresh/snapshot`, not
  `backend/resources`.
- Frontend resource reads go through `dataAccess` or refresh orchestrator
  paths. Direct `fetch` belongs only in `frontend/src/core/refresh/client.ts`.
- After `mage qc:prerelease`, inspect the worktree because `lint:fix` can
  modify files.

## Large Audit Guidance

If the user explicitly asks for parallel agents or delegation, split large
audits into independent work:

- Backend contract and refresh/resource-model paths.
- Frontend consumers, state, identity, and UI behavior.
- Tests, docs, skills, and validation gaps.
- Branch diff and user-facing summary.

Do not delegate the immediate blocker that the main agent needs for the next
step.

## Scope Reminder

Workflow-specific skills exist because those areas have fragile cross-layer
contracts, not because one area is more important than the others. Use
`.agents/context/app-areas.md` for broad app understanding, then choose the
smallest matching workflow skill: cluster/auth lifecycle,
permissions/capabilities, shared resource model, object map, object panel,
browse/tables, operations workflows, app shell, refresh subsystem, or
add-resource.
