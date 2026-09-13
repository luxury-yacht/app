### Added

- Some commonly-used CRDs are now first-class objects, with dedicated views and detail panels.
  - Argo CD `Application`, `ApplicationSet`, and `AppProject`.
  - Cert Manager `Certificate`, `Certificate Request`, and `ClusterIssuer`.
  - External Secrets operator `ClusterSecret`, `ClusterSecretStore`, and `ExternalSecret`.
  - Karpenter `EC2NodeClass`, `NodeClaim`, and `NodePool`
  - Prometheus `ServiceMonitor` and `PodMonitor`
- These new categories will only appear in the sidebar if they are discovered in the cluster.

### Changed

- Sidebar categories have been reorganized, with new Resources and Extensions categories.
  - Resources contains built-in resource objects, organized by subcategories as before.
  - CRDs and custom resources have been moved into the Extensions category.
