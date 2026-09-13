### Added

- Dedicated cert-manager, External Secrets, and Prometheus Operator resource views and detail panels, shown when their CRDs are discovered in the matching cluster or namespace scope.
- Argo CD and Karpenter CRDs are now first-class objects, with a dedicated view and detail panels. Sidebar items for these CRD types are only visible when discovered.

### Changed

- Organized the cluster sidebar into Resources (including Namespaces) and Extensions, with Overview, Attention, Browse, and Events above both groups.
- Grouped namespace views under Resources and Extensions, collapsed by default, with Workloads, Browse, Map, and Events as direct links.
