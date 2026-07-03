### Added

### Changed

- Clusters where the user lacks permission to list namespaces now fail fast:
  the sidebar shows "You do not have permission to list namespaces." instead
  of inferring namespaces from discovered objects. Manually adding accessible
  namespaces is planned follow-up work.

### Fixed

- The sidebar no longer re-downloads the full object catalog on every cluster
  change burst; namespace membership comes solely from the namespaces domain.
- Node rows no longer serve stale per-node pod counts after pod churn
  (the nodes snapshot validator now advances on pod store changes).
- Query-backed tables no longer issue an extra empty (304) refetch when
  another view fetches the same domain scope.
