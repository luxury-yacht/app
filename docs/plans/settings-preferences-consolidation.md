# Settings And Preferences Consolidation Plan

## Overview

Settings are spread across backend storage schema, backend defaults, backend
normalization, backend setters, frontend defaults, frontend normalizers,
frontend event emission, and settings UI state. This makes new preferences
costly to add and easy to get subtly wrong.

The goal is to make the backend the durable source of truth for preference
schema, defaults, bounds, enum values, validation, and persistence while
preserving the current frontend ergonomics and event-driven updates.

## Goals

- Reduce duplicated preference defaults and min/max constants.
- Make backend validation the authoritative contract.
- Keep frontend settings responsive through optimistic local state.
- Standardize persistence behavior, including rollback on failed writes.
- Make new preferences require fewer touched files.
- Keep app-state reads under `appStateAccess`.

## Non-Goals

- Do not redesign the Settings UI visually.
- Do not move app-state settings into refresh domains.
- Do not remove existing Wails bindings until the replacement path is in use.
- Do not change the on-disk settings file format unless a migration is
  explicitly covered by tests.
- Do not remove localStorage bootstrap behavior for appearance mode unless a
  replacement prevents startup theme flash.

## Current Hotspots

- `backend/app_settings.go`
  - Storage structs
  - Defaults
  - Clamps
  - File normalization
  - Runtime `AppSettings` projection
  - One setter per preference
  - Theme persistence and matching
- `frontend/src/core/settings/appPreferences.ts`
  - Frontend copy of defaults and bounds
  - Frontend normalizers
  - Preference cache
  - Event emission
  - One persistence function per backend setter
  - Theme API wrappers
- `frontend/src/ui/settings/sections/AppearanceSection.tsx`
  - Mode controls
  - Palette controls
  - Saved theme list
  - Theme editing
  - Drag/drop ordering
  - Backend validation calls

## Design Direction

Introduce a backend-owned settings schema response that describes the
preferences the frontend can edit.

Each schema entry should include:

- Preference key
- Type: boolean, integer, enum, string, color, layout, or object
- Default value
- Current value
- Optional min and max
- Optional enum options
- Optional validation metadata
- Whether changes are applied immediately or need a runtime side effect

The frontend should keep typed getters and setters for call sites, but those
wrappers should use shared schema metadata and a common update path rather than
duplicating every bound and default.

## Phase 1: Inventory And Contract Tests

- [ ] List every current preference in backend and frontend.
- [ ] Identify all preferences persisted in backend settings, backend app
      state, and localStorage.
- [ ] Add backend tests that assert default values and clamping behavior for
      every persisted preference.
- [ ] Add frontend tests that compare hydrated preferences against backend
      payload examples.
- [ ] Document intentionally local-only settings, such as last active settings
      tab and appearance bootstrap.

## Phase 2: Backend Schema Endpoint

- [ ] Add an app-state read for settings schema.
- [ ] Include defaults, bounds, enum values, and current values.
- [ ] Keep `GetAppSettings` unchanged for existing callers during transition.
- [ ] Add tests for schema defaults, bounds, enum values, and migration from
      older settings files.
- [ ] Route the frontend read through `frontend/src/core/app-state-access`.

## Phase 3: Generic Backend Update Path

- [ ] Add a typed backend update request for one or more preference changes.
- [ ] Reuse existing validation and side effects from current setters.
- [ ] Keep current one-off setters as wrappers initially.
- [ ] Ensure runtime side effects still run for:
      Kubernetes client QPS and burst,
      container logs per-scope and global limits,
      appearance mode,
      refresh settings.
- [ ] Add tests for partial update success, validation failure, persistence
      failure, and side-effect execution.

## Phase 4: Frontend Preference Store Cleanup

- [ ] Hydrate frontend defaults from backend schema or generated constants.
- [ ] Replace repeated normalizers with schema-based normalization.
- [ ] Replace fire-and-forget persistence with a common optimistic update
      helper.
- [ ] Roll back the local cache when backend persistence fails.
- [ ] Preserve existing event emissions for preference changes.
- [ ] Keep public getters like `getAutoRefreshEnabled()` stable until all
      consumers are migrated.

## Phase 5: Settings UI Decomposition

- [ ] Split `AppearanceSection` into smaller components:
      appearance mode selector,
      palette controls,
      color controls,
      theme list,
      theme editor,
      theme ordering.
- [ ] Extract a `useThemes` hook for load/save/delete/reorder/apply behavior.
- [ ] Keep backend pattern validation in the theme editor path.
- [ ] Add focused tests for theme editing, theme ordering, default theme saves,
      and validation errors.

## Phase 6: Retire Compatibility Paths

- [ ] Remove one-off frontend persistence functions after consumers use the
      common update path.
- [ ] Remove backend setter wrappers only after Wails bindings and frontend
      callers no longer need them.
- [ ] Remove old settings migration code only when the supported migration
      window is explicitly closed.
- [ ] Update `docs/architecture/data-access.md` or a settings-specific doc with
      the final app-state settings contract.

## Validation

Targeted checks while implementing:

```bash
go test ./backend -run 'Settings|Theme|AppSettings'
npm run test -- src/core/settings/appPreferences.test.ts
npm run test -- src/ui/settings
npm run typecheck
```

Before considering non-documentation implementation complete:

```bash
mage qc:prerelease
```

## Rollout Notes

The safest first step is contract tests plus a read-only schema endpoint. That
creates a source of truth without forcing a large frontend migration in the same
change. Once schema hydration is proven, migrate one preference group at a
time: refresh, table/display, Kubernetes API, object panel logs, object panel
layout, then appearance/themes.
