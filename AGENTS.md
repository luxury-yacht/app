# Repository Guidelines

This is a Wails desktop app. It uses Go for the backend, and React for the frontend.

- Documentation for the backend code is in backend/docs
- Documentation for the frontend code is in frontend/docs

## Rules

You must adhere to these at all times, no exceptions without explicit permission.

- Never do more than requested by the user without asking first.
- When stuck on a tough problem, ask questions.
- If you're not completely clear on what the problem is, ask questions.
- Never change the appearance or behavior of the app unless asked to do so.
- Use the latest stable versions for all dependencies.
- Don't add heavy dependencies without approval.
- Reuse existing components and styles as much as possible.
- Always add clear, understandable comments to code.
- Review and update the documentation as necessary after making changes.

## Development Guidelines

- Treat the object catalog as the single source of truth for namespace/cluster listings (`frontend/docs/architecture/refresh.md`); rely on `hasWorkloads`/`workloadsUnknown` flags instead of custom probes.
- All namespace/cluster data surfaces must be wired through the refresh orchestrator + diagnostics flow (`frontend/src/core/refresh`); register refresher constants, scopes, and manual targets per the refresh checklist and validate them in the Diagnostics panel—no ad-hoc polling loops.
- Manual refreshes and streaming domains belong to the backend refresh registry + ManualQueue; do not invent bespoke goroutines or HTTP handlers outside that lifecycle.
- All CSS colors and sizes must be tokenized, and must support Light and Dark themes
- Always render tabular data through the `GridTable` component and its shared column factories (see `frontend/docs/architecture/gridtable-consumer-guide.md`) instead of ad-hoc tables
  - Follow the column/interaction rules in `frontend/docs/architecture/tables.md` when updating or adding tables.

## Project Structure & Module Organization

- `main.go` launches Wails and ties the Go backend in `backend/` to the React frontend in `frontend/`.
- `backend/` hosts Kubernetes integrations; resource handlers follow `resource_<Kind>.go` and keep `_test.go` suites beside the code (for example `kubeconfigs_test.go`).
- `frontend/src/` adopts feature folders resolved through the `@core`, `@modules`, `@ui`, and `@shared` aliases; Vitest specs live next to implementations in `*.test.ts[x]` files.

## Coding Style & Naming Conventions

- The React/TypeScript side relies on Prettier (2-space indentation) and ESLint. Components are PascalCase, hooks begin with `use`, and cross-cutting helpers live in `frontend/src/shared`.
- Prefer the path aliases documented in `tsconfig.json` (`@core/refresh`, `@shared/utils`, etc.) instead of deep relative imports.
  - You may add new path aliases if necessary.
- Permission gating must flow through `ensureNamespaceActionCapabilities`, `registerAdHocCapabilities`, `evaluateNamespacePermissions`, and the bootstrap helpers in `frontend/src/core/capabilities` so TTLs, diagnostics, and batching remain accurate—no bespoke SubjectAccessReviews.
- Complex tables/streams (Cluster Nodes view, Object Panel logs, etc.) rely on shared hooks for virtualization, fallbacks, and context menus; extend those utilities instead of reimplementing scroll/selection/fallback logic.

## Testing Guidelines

- Always strive for test coverage of at least 80%.
- Backend tests stay adjacent to their targets with `_test.go` suffixes and `TestXxx` functions.
- Frontend specs mirror their features (for example `DiagnosticsPanel.test.ts`) and run with Vitest; append `--watch` for interactive loops.

## Commit & Pull Request Guidelines

- Do not create commits or pull requests. The user will handle that.
