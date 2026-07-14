### Added

- Added a Fleet view that compares health, capacity, metrics, and access across
  open clusters and links each row to that cluster's Overview or Needs Attention
  lens.
- Added backend-query Status and Node filters to namespace and All Namespaces
  Pods tables, with options covering the full selected scope.
- Added backend-query Status filters to Workloads and Cluster Nodes, with stable
  options covering the full selected namespace or cluster scope.

### Changed

- Added an Applications view that groups namespace workloads using Helm metadata,
  recommended application labels, and owner references, with visible confidence,
  health, workload counts, and ungrouped-workload disclosure.
