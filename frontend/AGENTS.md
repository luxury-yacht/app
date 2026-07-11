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
- Wire namespace/cluster data through the refresh orchestrator + diagnostics flow (`frontend/src/core/refresh`); no ad-hoc polling loops.
  Follow `docs/architecture/refresh-system.md` and
  `docs/architecture/data-access.md`.
- Treat backend `statusPresentation` and `ResourceLink.ref` as authoritative.
  Before adding frontend status styling, relationship navigation, or object
  identity helpers, follow `docs/architecture/shared-resource-model.md`.
- For frontend file placement and shared UI infrastructure, follow
  `docs/frontend/component-structure.md`.

## Refresh Orchestrator Notes

- Add backend-owned domain payload DTOs to
  `backend/internal/genrefreshcontracts/registry.go`, then run
  `go generate ./backend`. Never hand-edit
	`frontend/src/core/refresh/types.generated.ts` or format it with Biome; the
	Go generator is its only writer. Set domain payload mappings through
	`refreshPayloadType` in `backend/refresh/domain/refresh-domain-contract.json`.
	Keep only frontend-owned reducer state in `frontend/src/core/refresh/types.ts`.
- Register refresher names in `frontend/src/core/refresh/refresherTypes.ts` and timing in `frontend/src/core/refresh/refresherConfig.ts`.
- Register domains in `frontend/src/core/refresh/orchestrator.ts` and diagnostics config in `frontend/src/core/refresh/components/diagnostics/diagnosticsPanelConfig.ts`.
- Manual refresh targets are mapped in `frontend/src/core/refresh/refresherTypes.ts` and selected in `frontend/src/core/refresh/RefreshManager.ts`.
- Wire any SSE managers under `frontend/src/core/refresh/streaming`.
- Do not call `fetch` directly; use the refresh orchestrator/client (Biome plugins allow direct fetch only in the refresh and data-access infrastructure; see `frontend/biome.jsonc` and `frontend/biome-plugins/`).
- Import generated Wails App bindings only through `frontend/src/core/backend-api`; its explicit export list is the frontend backend-call allowlist. Application reads still belong in `appStateAccess` or `dataAccess`, and object mutations belong in their owning action/workflow client.
- Validate domain state in the Diagnostics panel.
- Catalog browse: keep snapshot/manual refresh flow (see `frontend/src/core/refresh/orchestrator.ts` catalog registration); avoid SSE-driven renders for Browse.
- Frontend reads must go through `dataAccess` or `appStateAccess` as documented
  in `docs/architecture/data-access.md`.

## App State And Settings

- Persisted app preferences hydrate from the backend settings schema through
  `appStateAccess` (`readAppSettingsSchema`) and mutate through the shared
  `UpdateAppPreferences` command.
- Keep typed frontend getters/setters in `frontend/src/core/settings`, but route
  persistence through the common optimistic update path instead of importing
  preference-specific generated Wails setters in UI components.
- `frontend/src/core/settings/appPreferences.ts` owns schema metadata caching,
  fallback metadata, and typed metadata helpers. Settings UI sections should
  consume backend-owned defaults, bounds, enum options, validation hints, and
  runtime flags through those helpers instead of fetching schema directly or
  duplicating constants locally.
- On failed preference persistence, rollback every frontend-owned optimistic
  side effect: preference cache values, preference change events, appearance
  mode localStorage, and appearance bootstrap localStorage.
- Frontend-owned state stays local when it is transient, component-local, or
  needed before Wails is available. Examples include the last active Settings
  tab and first-paint appearance bootstrap caches.

## UI Infrastructure Docs

- Shared table system: `docs/frontend/gridtable.md`.
- Live object age rendering: `docs/frontend/live-age.md`.
- Keyboard/focus and shortcut ownership: `docs/frontend/keyboard.md`.
- Blocking modal foundation: `docs/frontend/modals.md`.
- Shared tab component and drag coordinator: `docs/frontend/tabs.md`.
- Dockable object panels and grouped panel tabs:
  `docs/frontend/dockable-panels.md`.
- Shared YAML editor surfaces: `docs/frontend/yaml-editor.md`.
- Log viewers: `docs/workflows/logs/overview.md`.
- Object map UI: `docs/workflows/object-map.md`.

## Storybook

- Stories must use real components and real CSS classes — never inline style
  approximations. Mock only the data/provider layer, not the rendering.
- Changes belong in production code. Stories verify changes, they don't contain them.
- Before writing a story, trace ALL hook dependencies to identify required providers.
  Don't discover them one crash at a time.

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

- Practice red/green/refactor TDD (see root `AGENTS.md` Critical Rules): write the failing `*.test.ts[x]` case first, run Vitest to watch it fail for the right reason, then write the minimum to make it pass, then refactor under green.
- Frontend specs mirror their features (for example `DiagnosticsPanel.test.ts`) and run with Vitest; append `--watch` for interactive loops.
