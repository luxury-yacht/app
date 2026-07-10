### Added

- Added namespace search! Long-requested by David C., who said not having it is "gross".
  - `shift+ctrl/cmd+N` or clicking the new search button next to the Namespaces header in the sidebar will open the Command Palette in Namespace mode.

### Changed

- Cluster connection-state handling is more resilient: an unrecognized lifecycle state is now logged once and ignored instead of being able to silently stall data loading for that cluster.
- Internal type-safety hardening. Cluster lifecycle states, drain status rendering, drain progress phases, navigation view types, appearance mode, and object references now use closed types end-to-end, so an invalid state fails at compile time instead of causing a bug at runtime.
- Refresh API TypeScript contracts are now generated from backend Go DTOs, with stale-output and domain-parity checks to prevent cross-layer drift.

### Fixed

- Release notes tooltip for the update notification is now scrollable.
