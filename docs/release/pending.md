### Added

- Roles and Rolebindings are now visible in Object Maps
- Keyboard access to table row actions, tab Close controls, status
  popovers, and object-map actions, with guidance in Keyboard Shortcuts help.

### Changed

- Keyboard focus uses a soft halo instead of solid outlines in normal appearance modes.
- Tab and Shift+Tab move through controls within the current app region;
  Ctrl+Tab and Ctrl+Shift+Tab switch regions, including on macOS. These replace
  Ctrl+Alt+Arrow panel cycling.

### Fixed

- Restored the native Inspect Element menu and Inspector opening in macOS development builds.
- Tab accessibility groups now contain only tabs; existing Close and scroll
  buttons are exposed separately.
- Container logs crashing due to miscalculated virtualized window size
