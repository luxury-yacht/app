### Added

- Some commonly-used CRDs are now first-class objects, with dedicated views and detail panels. These categories will only appear in the sidebar if they are discovered in the cluster.
  - Argo CD
    - `Application`
    - `ApplicationSet`
    - `AppProject`
  - Cert Manager
    - `Certificate`
    - `CertificateRequest`
    - `Challenge`
    - `ClusterIssuer`
    - `Issuer`
    - `Order`
  - External Secrets operator
    - `ClusterExternalSecret`
    - `ClusterSecretStore`
    - `ExternalSecret`
    - `SecretStore`
  - Karpenter
    - `EC2NodeClass`
    - `Machine`
    - `NodeClaim`
    - `NodeOverlay`
    - `NodePool`
    - `Provisioner`
  - Prometheus Operator
    - `Alertmanager`
    - `PodMonitor`
    - `Prometheus`
    - `PrometheusRule`
    - `ServiceMonitor`

### Changed

- The Open Cluster button moved to the left and now stays pinned to the rightmost open cluster, instead of always being right-aligned.
- Sidebar categories have been reorganized, with new Resources and Extensions categories.
  - Resources contains built-in resource objects, organized by subcategories as before.
  - Extensions contains CRDs and custom resources, including the new CRDs mentioned above.
  - Helm has been moved to Extensions.
