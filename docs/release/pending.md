### Added

- The Cluster Overview's Resource Utilization card now shows "Collecting metrics…" while the first metrics collection is in flight.

### Changed

- Clusters where the user lacks permission to list namespaces now fail fast. The sidebar shows "You do not have permission to list namespaces."
- The Cluster Overview no longer requires node permissions ([#244](https://github.com/luxury-yacht/app/issues/244)). Identities without node access (such as the standard `view` role) now see pods, namespaces, workloads, and events instead of the page failing with "permission denied". Each affected card explains its own gap in place: the Nodes card notes the missing node permission, and Resource Utilization indicates when cluster capacity or pod requests/limits are unavailable.

### Fixed
