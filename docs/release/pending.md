### Added

- The app header now shows the active scope (cluster or namespace) and view.
- New Identities view shows Users and Groups, derived from RBAC objects. Click on a User or Group for more detail.

### Changed

- The Keyboard Shortcuts help modal has been redesigned with a category sidebar.
- The Details tab for `Role` and `ClusterRole` objects has been redesigned with a table of permissions grants that should be easier to scan than the previous card-style layout.

### Fixed

- Fixed cluster tab handling when clusters are rapidly opened and closed. Closed clusters close immediately and release their connections in the background. Closing a sibling no longer causes a catalog error.
- A failed cluster connection no longer interrupts healthy clusters opened alongside it or leaves failed tabs stuck connecting after another tab closes. Disconnected tabs explain how to retry by closing and reopening the tab.
