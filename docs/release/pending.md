### Added

- Command Palette is now in the OS **View** menu.
- Pagination controls now allow you to manually enter and jump straight to a specific page number.

### Changed

- Kubeconfig dropdown menu has been removed, and replaced with a more integrated open-cluster flow using the Command Palette.
  - Added `File -> Open Cluster` to the OS menus.
  - Added `ctrl/cmd+O` shortcut key to open a cluster.
  - Added a permanent `Open Cluster +` button on the cluster tab bar.
  - Command Palette gains an "open in Kubeconfig mode" to only show kubeconfigs.
- Cluster tab bar is now always visible, even if only one cluster is open.
- App header cleanup
  - Removed the cluster/namespace/view breadcrumbs, as they were visual clutter that didn't add much info.
  - Removed the Settings button. Settings is still reachable in the OS menus and with `ctrl/cmd+,`
  - Added a search button (magnifying glass icon) that opens the Command Palette
- The app now flags syntactically-invalid kubeconfigs and won't attempt to open them.
- Improved performance when paging through large tables.
- The app now warns if data has changed while a data export (copy to clipboard or save to file) is in progress.
- Error/Warning/Info Notifications (toast popups) are now color-coded by severity.

### Fixed

- When you jump to an object, the list now scrolls to and highlights that object even if it's on a different page. If the object has been filtered out or deleted, the list tells you and returns to the first page.
- Alt/option-clicking a namespace in Object Panel Details now takes you to that object in its list and selects the namespace in the sidebar.
