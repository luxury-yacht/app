# Wails v3 Follow-up Tracks

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
