### Added

- Pagination controls now allow you to manually enter and jump straight to a specific page number.
- Command Palette is now in the **View** menu
- New **Open Cluster** window lists every context in your kubeconfig directories as a directory → file → context tree — flagging invalid contexts and marking the ones already open. Open it with the **+** in the cluster tab bar, **⌘/Ctrl+O**, or **File → Open Cluster**.
- The cluster tab bar is now always visible — even with a single cluster or none — with a pinned **+** to open more.

### Changed

- Improved performance when paging through large tables.
- Managing kubeconfig directories now lives in the Open Cluster window; the header kubeconfig dropdown and the Settings → Kubeconfigs section have been removed.
- Pressing **⌘/Ctrl+W** on your last open cluster no longer quits the app — it closes the tab and leaves you on an empty workspace.
- When you copy or export "all matching rows" and the cluster changes while the rows are being gathered, the app now warns you that the results mix before-and-after data, instead of quietly returning an inconsistent set.
- Error/Warning/Info Notifications (toast popups) are now color-coded by severity.

### Fixed

- When you jump to an object, the list now scrolls to and highlights that object even if it's on a different page. If the object has been filtered out or deleted, the list tells you and returns to the first page.
- Alt/option-clicking a namespace in Object Panel Details now takes you to that object in its list and selects the namespace in the sidebar.
