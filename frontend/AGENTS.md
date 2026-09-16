# AGENTS.md (Frontend)

Applies to React/TypeScript code under `frontend/`.

## Development Guidelines

- Favor reusing existing components over creating new components.
- Render table data with `GridTable` and shared column factories; no ad-hoc tables.
  - Column factories live in `frontend/src/shared/components/tables/columnFactories.tsx`.
- Render Kubernetes age with the live-age contract in
  `docs/frontend/live-age.md`; do not refetch data only to advance relative age
  text.
- Resource utilization reads and adapters belong to
  `frontend/src/core/resource-metrics`; follow
  `docs/architecture/resource-metrics.md` before adding metric consumers.
- Wire namespace/cluster data through the refresh orchestrator + diagnostics
  flow (`frontend/src/core/refresh`); no ad-hoc polling loops. For timing or
  visibility changes, follow `docs/architecture/data-freshness.md`; for refresh
  mechanics, use the refresh skill's task routes below.
- Treat backend `statusPresentation` and `ResourceLink.ref` as authoritative.
  Before adding frontend status styling, relationship navigation, or object
  identity helpers, follow `docs/architecture/shared-resource-model.md`.
- For frontend file placement and shared UI infrastructure, follow
  `docs/frontend/component-structure.md`.

## Data Boundaries

- Reads use `dataAccess` for resources and `appStateAccess` for app state.
- Import generated `DesktopService` bindings only through
  `frontend/src/core/backend-api`; its explicit exports are the backend-call
  allowlist. Mutations belong in their owning action/workflow client.
- Do not call `fetch` directly from feature code; use the refresh/data-access
  infrastructure allowed by `frontend/biome.jsonc` and `frontend/biome-plugins/`.
- Generated refresh types have one Go-generator owner; never hand-edit or format
  them with Biome. Load domain wiring below when changing payloads or registration.

## Task Guidance

Read the matching route only when that contract changes:

| Change | Start here |
| --- | --- |
| Refresh payloads, registration, scheduling, streams, diagnostics | [refresh skill](../.agents/skills/refresh-subsystem/SKILL.md) |
| Settings schema, preferences, persistence, rollback | [app preferences](../docs/architecture/app-preferences.md) |
| Shared table behavior | [GridTable router](../docs/frontend/gridtable.md) |
| Shortcuts or focus | [keyboard](../docs/frontend/keyboard.md) |
| Blocking modals | [modals](../docs/frontend/modals.md) |
| Tabs or tab dragging | [tabs](../docs/frontend/tabs.md) |
| Docked/floating panels | [dockable panels](../docs/frontend/dockable-panels.md) |
| YAML editor mechanics | [YAML editor](../docs/frontend/yaml-editor.md) |
| Log viewers | [logs router](../docs/workflows/logs/overview.md) |
| Object map | [object map](../docs/workflows/object-map.md) |
| Storybook stories | [new-story skill](../.agents/skills/new-story/SKILL.md) |

## CSS

- Never use inline CSS; keep CSS in files.
- All form labels for inputs must have the exact same spacing unless told otherwise.
- Favor reusing shared styles in `frontend/styles` (the `@styles` alias); otherwise keep CSS close to the source (for example `ContextMenu.tsx` → `ContextMenu.css`).
- Always tokenize sizes/colors with shared tokens in `frontend/styles/tokens`; colors must support Light and Dark themes.
- Reuse an existing theme variable whenever one fits, instead of computing colors inline (no ad-hoc `color-mix`/hex) or defining a new one. Semantic theme vars (for example `--color-warning-bg`, `--color-warning-border`) live in `frontend/styles/appearance-modes/{light,dark}.css` and already track Light/Dark. Only add a new token when no existing var fits, and define it in both appearance modes.

## Project Structure & Module Organization

- `frontend/src/` adopts feature folders resolved through the `@core`, `@modules`, `@ui`, and `@shared` aliases.
  - Vitest specs live next to implementations in `*.test.ts[x]` files.

## Coding Style & Naming Conventions

- The React/TypeScript side relies on Biome for formatting and linting (2-space indentation).
- React Components are PascalCase.
- React hooks begin with `use`, and cross-cutting helpers live in `frontend/src/shared`.
- Prefer the path aliases documented in `tsconfig.json` (`@core/refresh`, `@shared/utils`, etc.) instead of deep relative imports.
  - Add new path aliases if necessary.

## Testing Guidelines

- Apply the [testing standard](../docs/workflows/testing.md) before adding a spec.
  Test actions and their results, state transitions, data selection, permissions,
  navigation, persistence, cleanup, and keyboard/accessibility contracts.
- Do not add tests solely for headings, help text, tooltip sentences, punctuation,
  capitalization, decorative classes, icon dimensions, or static render smoke
  checks. Copy and cosmetic styling changes normally need review, not new tests.
- Use text to find a control or identify fixture data when that supports a
  behavior assertion. Prefer typed state, enabled/disabled controls, callback
  payloads, and resulting UI state over matching an entire message. Keep exact
  strings when they are data or protocol contracts, such as exports and URLs.
- For behavior changes, practice red/green/refactor TDD: write the failing
  `*.test.ts[x]` case first, run Vitest to watch it fail for the right reason,
  then write the minimum to make it pass, then refactor under green.
- Frontend specs mirror their features (for example `DiagnosticsPanel.test.ts`) and run with Vitest; append `--watch` for interactive loops.
