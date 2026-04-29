### Added

- Many improvements to Object Panel Details
  - **Workloads** - new pod-state bar with scaled-to-zero and HPA-managed indicators; many other new and improved data rows; wider usage of status chips with tooltips to surface and explain settings.
  - **CronJobs** - new Job Timeline showing recent runs as color bars positioned by start time and sized by duration, with selectable time windows.
  - **Pods** - rewritten Overview with QoS badge, host info, container state chips.
  - **Containers section** - state chips with reason/message tooltips, image hover tooltips, init-container grouping with section headings, CPU/Memory label rows, restart-count warnings.
  - **Nodes** - condition chips with reason/message tooltips replace the "All Healthy" badge collapse; logical visual groupings of row types.
  - **Roles/ClusterRoles** - new RBAC Rules section. Verbs render as risk-colored chips (read vs write permissions).
  - **Storage/Network/Config** - improved detail info for Ingress, IngressClass, StorageClass, PV, PVC, ConfigMap, Secret.

### Changed

- About button removed from the app header. About modal is still reachable from the command palette and the OS menu.
- Panel focus now indicated with visual dimming.
- Some Kind badges reverted to previous colors via an override path for the hashed color assignment.

### Fixed

- Dead code related to scrollbar handling in linux removed.
- All permission checks now go through a single QueryPermissions path; legacy EvaluateCapabilities removed.
- New batched + parallelized permission discovery with retry/backoff greatly improves performance.
  - On a 1500-pod, 230-namespace cluster, permission checks went from ~3.7 min to ~5 sec.
- Diagnostics → Capabilities Checks and Effective Permissions tables restructured so large lists no longer lock up the UI.
