### Added

### Changed

- Previous/next pagination is now `ctrl+←/→` (`cmd+←/→` on macOS) to prevent conflicts when the arrow keys are used for horizontal scroll in wide tables.
- Confirmation dialogs initially focus the non-destructive Cancel action.
- Refresh API TypeScript contracts are now generated from backend Go DTOs, with stale-output and domain-parity checks to prevent cross-layer drift.

### Fixed

- The "Logs are hidden for N containers" warning in the logs view now clears once it no longer applies, instead of sticking around until the logs view was closed.
- If the logs stream delivers malformed data, the logs view now shows an error instead of loading forever.
- Select All/Select None buttons in dropdowns for data tables work correctly now.
