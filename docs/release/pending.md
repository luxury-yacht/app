### Added

- Nodes, Workloads, and Pods now have a Metrics tab with live CPU and memory usage graphs. Data on these graphs are ephemeral, and are cleared when the object is closed.

### Changed

- The Resource Utilization section in the object Details tab for Nodes, Workloads, and Pods has been moved to the new Metrics tab.

### Fixed

- The All Namespaces Events view now updates as events change; it previously stayed on its first page of results until reopened.
- The Overview's Recent Events now include recurring warnings that started over 24 hours ago (recorded through the newer events API), and list them by when they were last seen.
- An object's Events tab now shows the most recent events when it has more than 500, and no longer hides events recorded against another version of the same API.
- Involved objects of events recorded without an API version now open through a lookup by UID in the Events tables, an object's Events tab, and the Overview's Recent Events; the app no longer guesses the API version from the object's kind.
- Events that expired while the app was closed, or while a cluster was idle, no longer linger in the Events tables after reconnecting.
- The Diagnostics Catalog and Events cards no longer turn red when a different table's live updates fail to start.
