# AGENTS.md (Frontend)

Applies to React/TypeScript code under `frontend/`.

## Development Guidelines

- Favor reusing existing components over creating new components.
- Render table data with `GridTable` and shared column factories; no ad-hoc tables.
  - Column factories live in `frontend/src/shared/components/tables/columnFactories.tsx`.
- Wire namespace/cluster data through the refresh orchestrator + diagnostics flow (`frontend/src/core/refresh`); no ad-hoc polling loops.

## Refresh Orchestrator Notes

- Update `frontend/src/core/refresh/types.ts` (`RefreshDomain`, `DomainPayloadMap`) when adding domains.
- Register refresher names in `frontend/src/core/refresh/refresherTypes.ts` and timing in `frontend/src/core/refresh/refresherConfig.ts`.
- Register domains in `frontend/src/core/refresh/orchestrator.ts` and diagnostics config in `frontend/src/core/refresh/components/diagnostics/diagnosticsPanelConfig.ts`.
- Manual refresh targets are mapped in `frontend/src/core/refresh/refresherTypes.ts` and selected in `frontend/src/core/refresh/RefreshManager.ts`.
- Wire any SSE managers under `frontend/src/core/refresh/streaming`.
- Do not call `fetch` directly; use the refresh orchestrator/client (lint allows direct fetch only in `frontend/src/core/refresh/client.ts`, see `frontend/eslint.config.js`).
- Validate domain state in the Diagnostics panel.
- Catalog browse: keep snapshot/manual refresh flow (see `frontend/src/core/refresh/orchestrator.ts` catalog registration); avoid SSE-driven renders for Browse.

## CSS

- Never use inline CSS; keep CSS in files.
- Favor reusing shared styles in `frontend/src/styles`; otherwise keep CSS close to the source (for example `ContextMenu.tsx` → `ContextMenu.css`).
- Always tokenize sizes/colors with shared tokens in `frontend/src/styles`; colors must support Light and Dark themes.

## Project Structure & Module Organization

- `frontend/src/` adopts feature folders resolved through the `@core`, `@modules`, `@ui`, and `@shared` aliases.
  - Vitest specs live next to implementations in `*.test.ts[x]` files.

## Coding Style & Naming Conventions

- The React/TypeScript side relies on Prettier (2-space indentation) and ESLint.
- React Components are PascalCase.
- React hooks begin with `use`, and cross-cutting helpers live in `frontend/src/shared`.
- Prefer the path aliases documented in `tsconfig.json` (`@core/refresh`, `@shared/utils`, etc.) instead of deep relative imports.
  - Add new path aliases if necessary.

## Testing Guidelines

- Frontend specs mirror their features (for example `DiagnosticsPanel.test.ts`) and run with Vitest; append `--watch` for interactive loops.
