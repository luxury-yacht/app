### Changed

- The app now draws its own window controls and menus, so the app layout and UI/UX is consistent across all platforms.
  - Windows and Linux menus are in the app header. macOS menus stay in the OS menu bar.
- Floating panels now open as real OS windows, with the following caveats:
  - A floating panel belongs to the window it was spawned from. If you close the parent window, it will close all child windows.
  - Tabs can only be moved between the parent window and its children. They cannot be moved to a different parent/child.
  - Dragging a tab out to create a new floating window is not currently supported on Linux, due to the complexity of supporting multiple distributions and window managers. In Linux, you must click the Floating Window icon to create a new floating window for that tab set.

### Fixed

- Modals now account for app zoom, keeping their controls reachable.
