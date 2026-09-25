### Added

- Added Cluster → Identities outside Resources, showing users and groups referenced by visible RBAC bindings and visible service accounts, with direct binding counts, grant scopes, and links to source bindings.

### Changed

### Fixed

- Fixed cluster tab handling when clusters are rapidly opened and closed. Closed clusters close immediately and release their connections in the background. Closing a sibling no longer causes a catalog error.
- A failed cluster connection no longer interrupts healthy clusters opened alongside it or leaves failed tabs stuck connecting after another tab closes. Disconnected tabs explain how to retry by closing and reopening the tab.
