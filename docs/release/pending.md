### Added

- Added a Global Clusters view that compares health, capacity, metrics, and
  access across open clusters and links each cluster name to that cluster's
  Overview.
- Added backend-query Owner and Node filters to namespace and All Namespaces
  Pods tables, with options covering the full selected scope.
- Added backend-query Status filters to Workloads and Cluster Nodes, with stable
  options covering the full selected namespace or cluster scope.
- Added backend-query Type, Reason, and Source filters to cluster, namespace,
  and All Namespaces Events, with searchable high-cardinality options.

### Changed

- Made Global a first-class workspace with its own tab and retained navigation,
  independent of the foreground cluster tab.
- Combined namespace Workloads and Pods into independently filterable,
  sortable, paginated tables with a collapsible, resizable split. Selecting a
  workload now populates the standard Namespace and Owner filters, resolving
  ReplicaSet and Job ancestry and preserving ownerless Pods.
- Rendered shared dropdown menus in a viewport-aware overlay so opening one no
  longer resizes or clips tables beside split panes and docked panels.
- Made every multi-select Kinds filter searchable and gave each one explicit
  Select all and Select none controls.
- Removed the visible Workloads/Pods divider band and moved the expand/collapse
  control to the left edge of the Pods filter bar. Collapsed Pods now retains a
  compact `Show Pods` header instead of removing its expansion control. The
  split retains a one-pixel separator that thickens when its resize handle is
  hovered or dragged and remains visible when Pods is collapsed.
