### Changed

- Workspace and native object-panel windows now use integrated app-rendered window controls on Windows and Linux while retaining native traffic-light controls on macOS. Windows and Linux workspaces also move the application menu into the titlebar, expose all-edge resize handling, and keep the maximize/restore action synchronized with native window state.
- Floating object-panel groups now open as independent native application windows owned by their workspace. Groups can dock back to the right or bottom with acknowledged, rollback-safe handoffs; unsaved YAML and in-flight mutations protect moves and every close path. Default right and bottom docks are 600 pixels, and native panel windows default to 600 by 800 pixels; these defaults remain configurable in Settings.
- Object-panel tabs can now be dragged between docked and native panel windows. On macOS and Windows, dragging a tab out creates a new one-tab native window, without the macOS drag preview snapping back to its source. Linux drag-out is deferred for this release; use Float to move the entire panel group into a native window. Tearing off the only tab in a native source leaves that window unchanged. Tab moves preserve owner, cluster, object, ordering, and active-view identity and leave the source intact until the destination is ready.
- The Network view's generic `Details` column has been replaced by three more specific columns (`Context`, `Network`, and `Summary`) to provide more useful data without having to open the Object Panel.
- Namespaces in the Attention view are now clickable.
- Clicked Namespace links should now properly scroll into view, and default to the Workloads view instead of Browse.

### Fixed

- Restored Windows and Linux application accelerators in native floating panel windows, including guarded tab close and application quit, while keeping shortcut behavior consistent across transient menus, palettes, and modals. macOS zoom-in now uses the physical `=` key and native accelerators remain visible in keyboard help.
- Closing a right-docked panel on Linux no longer leaves repaint artifacts over GridTable filter controls.
- Frameless Linux workspace and panel windows now have a theme-aware outline that keeps their edges distinct over similarly coloured windows.
- Frameless Windows and Linux windows now show the matching directional resize cursor on every edge and corner, including where the resize region overlaps app-header controls.
- App zoom no longer shifts window resize hit areas away from the window edges.
- Fixed a performance regression introduced by `client-go`. The bump to `v0.35.0` enabled `WatchList` by default, which degraded data load performance in the app by requiring potentially very large data sets to be sent in total before showing any data. The previous `list -> watch` behavior has been restored.
- Unreachable previously-opened clusters no longer block startup.
- Streamed pod logs should now properly retain their proper scroll positions, whether auto-scrolling or a manual fixed scroll position.
