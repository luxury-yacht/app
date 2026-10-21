### Added

### Changed

- Refresh:
  - Cluster tabs you are not looking at no longer refresh in the background. A tab's data refreshes when you return to it.
  - The "Refresh background clusters" setting is removed.
- Scrollbar tweaks. They are wider and higher-contrast. They appear only while scrolling or when the pointer is over the scroll area, and fade out shortly after scrolling stops.

### Fixed

- The Diagnostics panel no longer closes when you switch cluster tabs.
- Closing the app window a floating panel is docking into no longer leaves that panel window unresponsive for up to 15 seconds.
- Tables:
  - Gateway API resources, HPAs, CRDs, and Helm releases update in their tables as soon as they change. Before, a table could keep the old rows until the next change.
  - Those tables no longer refetch every 15 seconds when nothing has changed.
  - A workload's Pods list drops a pod as soon as the pod stops belonging to that workload.
