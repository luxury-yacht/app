# Wails v3 Follow-up Tracks

Status: deferred; not part of the core Wails v3 migration acceptance gate
Created: 2026-08-12

## Why these are separate

The core migration preserves the existing product contract while replacing the
desktop framework. The tracks below change product ownership or behavior and
therefore require separate approval, implementation, and validation. Deferral
is an explicit decision, not evidence that the feature has been implemented.

## Service decomposition

Decision: keep one registered `backend.App` service and the explicit frontend
allowlist. Do not expose duplicate compatibility services.

- [ ] Map every currently bound method and frontend facade method to one
      candidate service owner, including shared dependencies, lifecycle order,
      event ownership, and methods that should cease to be bound.
- [ ] Define cohesive service candidates from current domain ownership rather
      than arbitrary method counts.
- [ ] Keep process-wide Kubernetes clients, refresh infrastructure, persistence,
      and desktop capabilities outside bound services; inject only what each
      service needs.
- [ ] Add binding-boundary tests proving each facade exposes only its approved
      methods and generated bindings cannot bypass the allowlists.
- [ ] If approved, migrate one vertical slice at a time and test service
      startup/shutdown ordering before removing the old `App` methods.

Non-goal while deferred: changing the refresh transport or retaining duplicate
binding methods as a compatibility layer.

## Native multi-window

Decision: keep **New Window**, `Cmd/Ctrl+N`, process spawning, and dormant
callbacks absent.

- [ ] Define independent workspace state, intentionally shared process services,
      and the exact selection, navigation, settings, menu, and geometry state
      owned per window.
- [ ] Require explicit window identity in commands, events, readiness, menus,
      persistence, and close hooks while preserving `clusterId` and complete
      Kubernetes object identity.
- [ ] Prove two windows become ready independently, closing one does not tear
      down process services, and each window reads and writes only its own state.
- [ ] If approved, add named-window creation and user-facing entry points only
      after the lifecycle tests pass.
- [ ] Exercise concurrent populated workspaces across auth recovery, dialogs,
      events, shell/log operations, refresh, and quit.

Non-goal while deferred: a hidden feature flag or a return to one process per
window.

## Wails v3 updater

Decision: retain the notification-only GitHub release check and release-page
link. Do not add install/restart behavior without an approved security and
rollback contract.

- [ ] Compare the current `UpdateInfo`, `GetAppInfo`, `app-update`, status-chip,
      About-modal, dev-build suppression, and download-URL contract with the
      selected Wails updater.
- [ ] Choose notification-only parity or full download/install/restart behavior,
      including version injection, asset matching, skip/remind policy, failures,
      release notes, and UI ownership.
- [ ] Before installation, define digest and signature verification, key
      rotation, CI secret ownership, platform signing/notarization, and staged
      rollback.
- [ ] Add offline state-machine and release-contract tests for every outcome.
- [ ] If approved, move all consumers atomically and remove the current release
      client only after the replacement owns the complete contract.

Non-goal while deferred: silently turning a release notification into an
automatic installer.

## System tray

Decision: preserve the current close/quit lifecycle and single app-menu action
registry. Do not introduce close-to-tray behavior.

- [ ] Define whether the tray is always present, opt-in, or platform-specific,
      including Dock, taskbar, notification-area, unsupported-Linux, last-window,
      hide, and quit behavior.
- [ ] Share command/action definitions with the app menu, shortcuts, and command
      palette so labels, state, permissions, and callbacks cannot drift.
- [ ] Define platform/theme icon assets and keep ownership in application
      composition.
- [ ] Test show/focus, settings, dynamic labels, explicit Quit, last-window
      close, startup, and shutdown; include New Window only if multi-window is
      separately approved.
- [ ] If approved, smoke-test presence and lifecycle on every release OS and
      degrade cleanly where Linux tray support is unavailable.

Non-goal while deferred: adding a React-owned tray lifecycle or a second set of
menu actions.
