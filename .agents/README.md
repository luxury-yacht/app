# Agent Router

Use this index only when a task is broad, ambiguous, or crosses workflows.
`AGENTS.md` files are injected by scope; do not reread them. Open one matching
skill first, then only the docs or references that skill selects.

## Route by task

| Task | Skill or contract | Primary code |
| --- | --- | --- |
| Structural audit | `.agents/skills/app-review/SKILL.md` | Inventory affected systems before choosing paths |
| Branch readiness or PR summary | `.agents/skills/branch-review/SKILL.md` | Read-only git diff plus changed contract paths |
| Add a Kubernetes kind | `.agents/skills/add-resource/SKILL.md` | `backend/kind`, `backend/resources`, required consumers |
| Refresh, snapshot, stream, diagnostics | `.agents/skills/refresh-subsystem/SKILL.md` | `backend/refresh`, `frontend/src/core/refresh` |
| Cluster/auth/kubeconfig lifecycle | `.agents/skills/cluster-auth-lifecycle/SKILL.md` | backend client/auth setup, frontend cluster state |
| Catalog, Browse, views, tables | `.agents/skills/browse-tables/SKILL.md` | `backend/objectcatalog`, snapshot builders, browse/cluster/namespace modules |
| Shared identity, status, facts, links | `.agents/skills/shared-resource-model/SKILL.md` | `backend/resourcemodel`, per-kind models, frontend render utilities |
| Permissions, RBAC, action availability | `.agents/skills/permissions-capabilities/SKILL.md` | capability/permission services and action consumers |
| Object details, YAML, actions, panels | `.agents/skills/object-panel/SKILL.md` | object-panel modules, YAML/action/detail backends |
| Logs, shell, debug, port-forward, drain | `.agents/skills/operations-workflows/SKILL.md` | operation/session backends and workflow UI |
| Object graph/map | `.agents/skills/object-map/SKILL.md` | object-map snapshot, model, renderer, panel support |
| Settings, navigation, shortcuts, modals | `.agents/skills/app-shell/SKILL.md` | settings backend, app-state access, `frontend/src/ui` |
| New Storybook story | `.agents/skills/new-story/SKILL.md` | component and its real providers/hooks |
| Release notes | `.agents/skills/draft-release-notes/SKILL.md` | git log and `docs/release/pending.md` |

## Architecture ownership

| Concern | Contract | Entry points |
| --- | --- | --- |
| Multi-cluster and auth | `docs/architecture/multi-cluster.md`, `docs/architecture/auth.md` | app lifecycle/client setup, cluster contexts |
| Freshness and refresh | `docs/architecture/data-freshness.md`, `docs/architecture/refresh-system.md` | `backend/refresh`, `frontend/src/core/refresh` |
| Catalog and Browse | `docs/architecture/catalog.md` | `backend/objectcatalog`, catalog snapshot, Browse |
| Shared resource model | `docs/architecture/shared-resource-model.md` | `backend/resourcemodel`, kind registry, status/link consumers |
| Frontend data access | `docs/architecture/data-access.md` | `frontend/src/core/data-access`, app-state access |
| Permissions | `docs/architecture/permissions.md` | permission gates, capabilities, action hooks |
| Large tables | `docs/architecture/large-data.md`, `docs/frontend/gridtable.md` | typed queries, resource tables, `GridTable` |
| Object panel/map | `docs/frontend/component-structure.md`, `docs/workflows/object-map.md` | object panel and map modules |
| Operations | `docs/workflows/logs/overview.md`, `docs/workflows/shell-debug.md` | log/session/maintenance services and UI |

## Shared boundaries

- List/table payloads live in `backend/refresh/snapshot`; rich details and
  imperative operations live in `backend/resources`.
- Frontend resource reads use `dataAccess` or refresh orchestration. Direct
  `fetch` belongs only in `frontend/src/core/refresh/client.ts`.
- Backend `statusPresentation` and `ResourceLink.ref` own primary status and
  relationship navigation.
- Resource metrics use `frontend/src/core/resource-metrics`; absolute timestamps
  drive live age rendering without snapshot refetches.
- The root identity, cluster-scope, TDD, git, and final-validation contracts
  apply everywhere and should not be repeated in workflow skills.
