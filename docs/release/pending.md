### Added

- The Cluster Overview's Resource Utilization card now shows "Collecting metrics…" while the first metrics collection is in flight (distinct from metrics-server being unavailable), and refreshes within one collection instead of waiting for the next poll.

### Changed

- Clusters where the user lacks permission to list namespaces now fail fast. The sidebar shows "You do not have permission to list namespaces."

### Fixed

- Switching cluster tabs no longer shows "Starting data services" for a cluster whose data is still on screen: re-warming a backgrounded cluster keeps it Ready instead of demoting it to loading.
