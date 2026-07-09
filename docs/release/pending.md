### Added

- Long-requested by David C., who said not having it is "gross": search for namespaces! Open the Command Palette in namespace search mode either with `shift+ctrl/cmd+N` or by clicking the new search button next to the Namespaces header in the sidebar.

### Changed

- Cluster connection-state handling is more resilient: an unrecognized lifecycle state (e.g. from a mismatched backend/frontend version) is now logged once and ignored instead of being able to silently stall data loading for that cluster.
- Internal type-safety hardening. Cluster lifecycle states, drain status rendering, drain progress phases, navigation view types, appearance mode, and object references now use closed types end-to-end, so an invalid state fails at compile time instead of causing a bug at runtime.

### Fixed

- Release notes tooltip for the update notification is now scrollable.
