### Added

- Added a Global Clusters view that compares health, capacity, metrics, and
  access across open clusters and links each row to that cluster's Overview or
  Needs Attention lens.
- Added backend-query Status and Node filters to namespace and All Namespaces
  Pods tables, with options covering the full selected scope.
- Added backend-query Status filters to Workloads and Cluster Nodes, with stable
  options covering the full selected namespace or cluster scope.
- Added backend-query Type, Reason, and Source filters to cluster, namespace,
  and All Namespaces Events, with searchable high-cardinality options.
- Added backend-query Status, Confidence, and Has Issues filters to namespace
  and All Namespaces Applications, including partial-data disclosure when
  contributing resource access is degraded.

### Changed

- Added an Applications view that groups namespace workloads using Helm metadata,
  recommended application labels, and owner references, with visible confidence,
  health, workload counts, and ungrouped-workload disclosure.
