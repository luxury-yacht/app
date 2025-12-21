# AGENTS.md

You are a developer working on Luxury Yacht, an application for viewing and managing kubernetes cluster resources.

Luxury Yacht is a Wails desktop app. We use Wails v2, as v3 is in alpha and not production-ready. Documentation for Wails version 2 is here: https://wails.io/docs/introduction

Luxury Yacht uses Go for the backend, and React for the frontend.

## Rules

You must adhere to these at all times. If you want an exception to these rules you must ask for explicit permission.

- Never do more than what is requested by the user.
- Never change the appearance or behavior of the app unless asked to do so.
- When stuck on a tough problem, ask questions.
- If you're not completely clear on what the problem is, ask questions.

## Development Guidelines

- Favor reusing existing components over creating new components.
- Always add clear, understandable comments to code.
- Always render table data with the `GridTable` component and its shared column factories instead of ad-hoc tables.
- Treat the object catalog as the single source of truth for namespace/cluster listings.
- All namespace/cluster data surfaces must be wired through the refresh orchestrator + diagnostics flow (`frontend/src/core/refresh`); register refresher constants, scopes, and manual targets per the refresh checklist and validate them in the Diagnostics panel—no ad-hoc polling loops.
- Manual refreshes and streaming domains belong to the backend refresh registry + ManualQueue; do not invent bespoke code outside that lifecycle.

### Dependencies

- Never add dependencies without approval from the user.
- Always use the latest stable versions for all dependencies.

### CSS

- Never use inline CSS. All CSS must be in a CSS file.
- Favor reusing existing styles over creating new styles. Use shared CSS in `frontend/src/styles` as much as possible.
  - When this is not possible, keep the CSS as close to the source as possible. For example, `ContextMenu.tsx` has its CSS in `ContextMenu.css`.
- Always tokenize sizes and colors. Reuse existing tokens when possible.
- CSS Colors must support Light and Dark themes.

### Project Structure & Module Organization

- `main.go` launches Wails and ties the Go backend in `backend/` to the React frontend in `frontend/`.
- `backend/` hosts Kubernetes integrations.
  - resource handlers follow `resource_<Kind>.go` and keep `_test.go` suites beside the code (for example `kubeconfigs_test.go`).
- `frontend/src/` adopts feature folders resolved through the `@core`, `@modules`, `@ui`, and `@shared` aliases.
  - Vitest specs live next to implementations in `*.test.ts[x]` files.

### Coding Style & Naming Conventions

- The React/TypeScript side relies on Prettier (2-space indentation) and ESLint.
- React Components are PascalCase.
- React hooks begin with `use`, and cross-cutting helpers live in `frontend/src/shared`.
- Prefer the path aliases documented in `tsconfig.json` (`@core/refresh`, `@shared/utils`, etc.) instead of deep relative imports.
  - Add new path aliases if necessary.

### Testing Guidelines

- Always strive for test coverage of at least 80%.
- Backend tests stay adjacent to their targets with `_test.go` suffixes and `TestXxx` functions.
- Frontend specs mirror their features (for example `DiagnosticsPanel.test.ts`) and run with Vitest; append `--watch` for interactive loops.

### Commit & Pull Request Guidelines

- Do not create commits or pull requests. The user will handle that.
