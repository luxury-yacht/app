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

- Karpenter detail panels lead with condition progress and the blocking reason instead of a trailing conditions list: NodeClaims show provisioning (Launched → Registered → Initialized → Ready) and, while a node is being removed, termination progress; NodePools show readiness (ValidationSucceeded → NodeClassReady → Ready). Disruption conditions (Drifted, Consolidatable) are colored by what they mean. The Capacity section is now a table: NodeClaims list allocatable next to capacity, and NodePools list capacity against limits with the used percentage. The NodeClaim instance type, capacity type, zone and architecture are folded into one row.
- Prometheus Operator ServiceMonitor and PodMonitor detail panels say what they select (Services or Pods), resolve the default namespace scope to the object's namespace, and show each scrape endpoint as one compact card (port, scheme and path, scrape interval and timeout) instead of a row per field.
- ServiceMonitor, PodMonitor and PrometheusRule no longer show an "Unknown" status in the table or the details panel; those kinds have no status in the Prometheus Operator API.
- Argo CD detail panels are more compact: Applications lead with health, sync and the last sync operation (with its message in place), destination and project become rows, sources are one-line cards titled by name, chart or repository, and the sync policy reads as a single summary. ApplicationSet templates fold into rows with one-line generator cards, and AppProject destinations, permissions, roles and sync windows use the same compact cards.
- Sidebar categories have been reorganized, with new Resources and Extensions categories.
  - Resources contains built-in resource objects, organized by subcategories as before.
  - CRDs and custom resources, including the new CRDs mentioned above, have been moved into the Extensions category.
