### Added

- Pagination controls now allow you to manually enter and jump straight to a specific page number.
- Command Palette is now in the **View** menu

### Changed

- Improved performance when paging through large tables.
- When you copy or export "all matching rows" and the cluster changes while the rows are being gathered, the app now warns you that the results mix before-and-after data, instead of quietly returning an inconsistent set.
- Error/Warning/Info Notifications (toast popups) are now color-coded by severity.

### Fixed

- When you jump to an object, the list now scrolls to and highlights that object even if it's on a different page. If the object has been filtered out or deleted, the list tells you and returns to the first page.
- Alt/option-clicking a namespace in Object Panel Details now takes you to that object in its list and selects the namespace in the sidebar.
