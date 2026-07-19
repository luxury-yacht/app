### Added

- Added a Cluster Attention view with severity, kind, namespace, finding-type,
  and status filters; active filter chips; and persisted ignore scopes.
- Added Global → Namespaces and Cluster → Namespaces views for comparing and
  opening namespace state at the appropriate scope.
- Added a Global Clusters view that compares health, capacity, and metrics across
  open clusters and links each cluster name to that cluster's Overview.
- Added backend-query Owner and Node filters to namespace and All Namespaces
  Pods tables, with options covering the full selected scope.
- Added backend-query Type, Reason, and Source filters to cluster, namespace,
  and All Namespaces Events, with searchable high-cardinality options.
- Added object, cluster, and all-cluster ignore scopes for each Attention
  finding, with persisted rules that can be restored from the Attention view.

### Changed

- Made Global a first-class workspace with its own tab and retained navigation,
  independent of the foreground cluster tab.
- Made Cluster Overview the attention landing surface: node problem signals link
  to Cluster Nodes, pod problem signals link to the relevant Workloads/Pods
  results, and warning events link to the involved object.
- Combined namespace Workloads and Pods into independently filterable,
  sortable, paginated tables with a collapsible, resizable split. Selecting a
  workload now populates the standard Namespace and Owner filters, resolving
  ReplicaSet and Job ancestry and preserving ownerless Pods.
- Rendered shared dropdown menus in a viewport-aware overlay so opening one no
  longer resizes or clips tables beside split panes and docked panels.
- Kept portaled dropdown menus anchored to their triggers when application zoom
  is above or below 100%.
- Hid table pagination controls when an exact result contains 25 or fewer
  objects and no previous or next page is available.
- Standardized absent table values on a dimmed hyphen across resource,
  object-panel, parsed-log, and diagnostics tables.
- Displayed zero restart counts as the dimmed no-value hyphen in Nodes,
  Workloads, and Pods tables while preserving numeric restart sorting.
- Removed redundant metrics-availability banners from Workloads and Pods
  tables; the app-level metrics status remains the availability indicator.
- Made every multi-select Kinds filter searchable and gave each one explicit
  Select all and Select none controls.
- Favorites now save every filter declared by a GridTable and save both the
  Workloads and Pods panes together. Version 1 and 2 favorites are silently
  migrated on app start; an individual favorite that cannot be migrated is
  deleted while migration continues for the remaining favorites. Files from a
  newer schema are rejected without being rewritten so a newer app's data is
  preserved.
- Removed the visible Workloads/Pods divider band and moved the expand/collapse
  control to the left edge of the Pods filter bar. Collapsed Pods now retains a
  compact `Show Pods` header instead of removing its expansion control. The
  split retains a one-pixel separator that thickens when its resize handle is
  hovered or dragged and remains visible when Pods is collapsed.

### Fixed

- Kept cluster-scoped data in place when switching open cluster tabs instead of
  triggering a manual refresh or racing the backend foreground re-warm.
- Refreshed YAML and object maps when versionless snapshot payloads change, so
  deleted or updated objects no longer remain visible from a stale response.
