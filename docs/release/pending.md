### Added

- Added Cluster → Identities outside Resources, showing users and groups referenced by visible RBAC bindings, with direct binding counts, grant scopes, and links to source bindings. User and Group badges open read-only Details panels with binding and role links.

### Changed

- Role and ClusterRole Details show a Permissions table with one row per resource and every verb the role grants it, similar to `kubectl describe`. Grants limited to named objects are marked. ClusterRole "Used by" lists all its bindings in one place, with namespaces shown for RoleBindings.

### Fixed

- Fixed cluster tab handling when clusters are rapidly opened and closed. Closed clusters close immediately and release their connections in the background. Closing a sibling no longer causes a catalog error.
- A failed cluster connection no longer interrupts healthy clusters opened alongside it or leaves failed tabs stuck connecting after another tab closes. Disconnected tabs explain how to retry by closing and reopening the tab.
