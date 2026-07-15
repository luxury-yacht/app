### Added

- Added a Global Clusters view that compares health, capacity, metrics, and
  access across open clusters and links each cluster name to that cluster's
  Overview.
- Added backend-query Status and Node filters to namespace and All Namespaces
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
  workload scopes the Pods table through ReplicaSet and Job ownership.
- Rendered shared dropdown menus in a viewport-aware overlay so opening one no
  longer resizes or clips tables beside split panes and docked panels.
