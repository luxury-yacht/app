### Added

- Restored the dedicated Pods view.

### Changed

- Workloads and Nodes now embed a Pods table, containing the pods that are child objects of that workload or node. This replaces the pods pane that was fixed to the bottom of the window.
  - Click the row's Pods count or press Space to show or hide its pods.
  - The pods table has its own filters, sort, and columns. This is completely independent of the filter, sort, and column settings of the parent view.
- Sidebar Workloads moved into the Resources group.
- Application Logs now use the same layout and controls as container logs. Application logs buffer size increased from 1,000 to 10,000 logs.

### Fixed

- Application Logs and Diagnostics no longer show a Float button that did nothing.
