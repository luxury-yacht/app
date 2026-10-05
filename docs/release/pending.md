### Added

- Added items to the Attention view
  - Warns when a Karpenter NodePool is using more than 80% of its CPU or memory limit.
  - Flags Argo CD issues. Applications that are degraded, failed to sync, report an error, are out of sync, or are missing resources, and ApplicationSets that hit an error.

### Changed

- The timestamp button in container logs has a menu for switching between UTC and local time.
- The Pretty JSON and table buttons in the Logs tab are now one format button. Click it to cycle through Raw, Pretty, and Table, or pick one from its menu.
- The Pods, Containers, and Node Logs source dropdowns in the Logs tab now size to fit their contents.
- Search in the Logs tab now opens in its own row from the search button, or with ⌘F / Ctrl+F. Closing the row keeps the filter applied.
- The mouse wheel now zooms instead of scrolling in the Object Map.
- NetworkPolicy, Ingress, route, Service, and EndpointSlice details now show traffic as a simple flow diagram.
- The Argo CD view shows Sync and Health as colored status chips.

### Fixed

- Service IPs and ports no longer get cut off or overlap in the Network view. Long port lists are shortened, with the full list on hover.
- Service endpoint counts are more accurate, and Service details show a warning only when something needs attention, such as a Service with no endpoints.
- HTTP and gRPC route details now show all of a rule's match conditions and each backend's port and weight.
- NetworkPolicy details now show every selector condition, and show an empty selector as matching everything instead of leaving it blank.
