---
name: app-shell
description: Work on settings, command palette, sidebar, shortcuts, modals, dockable panels, favorites, global navigation, persistence, and visual shell tests
---

# App Shell

Use this when touching settings, preferences, command palette, sidebar,
shortcuts, global navigation, modals, overlays, dockable panels, favorites,
saved views, app-shell persistence, or visual shell tests.

## Core Contracts

Read:

1. `AGENTS.md`
2. `frontend/AGENTS.md`
3. `docs/frontend/component-structure.md`
4. `docs/frontend/keyboard.md`
5. `docs/frontend/modals.md`
6. `docs/frontend/tabs.md`
7. `docs/frontend/dockable-panels.md`
8. `docs/architecture/data-access.md` for app state and persisted reads

Settings-specific contract:

- Persisted app preferences and runtime-enforced settings are backend-owned and
  described by `readAppSettingsSchema`.
- Frontend preference setters should use the shared optimistic update path that
  calls `UpdateAppPreferences`, then roll back cache, emitted events, and any
  appearance localStorage mirrors on failure.
- Frontend-only or bootstrap state stays local when it is transient or needed
  before Wails is available. Do not move local UI state into the backend just
  because it appears in Settings.
- Object panel position and layout defaults are persisted preferences with
  backend-normalized defaults.

## Entry Points

- `frontend/src/ui/settings`
- `frontend/src/core/settings`
- `frontend/src/core/app-state-access`
- `backend/app_settings.go`
- `frontend/src/ui/command-palette`
- `frontend/src/ui/shortcuts`
- `frontend/src/ui/navigation`
- `frontend/src/ui/layout`
- `frontend/src/ui/dockable`
- `frontend/src/ui/modals`
- `frontend/src/ui/favorites`
- `frontend/src/shared/components/modals`
- `frontend/src/shared/components/tabs`

## Checklist

- [ ] User-facing labels, icons, categories, and command-palette entries stay
      aligned across surfaces.
- [ ] Settings and persistence keys are scoped correctly, including cluster or
      namespace identity when the state is cluster data.
- [ ] Persisted preferences hydrate from backend schema metadata instead of
      duplicating defaults and bounds in UI code.
- [ ] Preference mutations use `UpdateAppPreferences` semantics: atomic
      validation, persistence before runtime side effects, and rollback on
      failure.
- [ ] Local-only Settings state and first-paint bootstrap caches remain
      frontend-owned.
- [ ] Keyboard shortcuts respect focus ownership and text-input behavior.
- [ ] Modals preserve focus trap, drag regions, and keyboard dismissal behavior.
- [ ] Dockable panel and tab changes preserve selection, close, drag/drop, and
      cluster/object identity behavior.
- [ ] Visual changes reuse existing CSS/tokens and avoid inline styles.
- [ ] Tests cover persistence, keyboard/focus, and changed UI state.
- [ ] Non-doc changes pass `mage qc:prerelease`.

## Validation

Use focused checks while iterating:

```sh
npm run typecheck --prefix frontend
npm run test --prefix frontend -- settings command-palette shortcuts modals dockable favorites
```

Use browser or Storybook validation for visual behavior, then run
`mage qc:prerelease` for non-documentation changes.
