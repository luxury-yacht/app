### Added

### Changed

- Clusters where the user lacks permission to list namespaces now fail fast. The sidebar shows "You do not have permission to list namespaces."

### Fixed

- Namespace views no longer issue a second, unused base-scope fetch alongside every table refresh (one request per metric tick instead of two).
