### Added

- Support for batch operations.
  - Batch select on tables. A toolbar button turns on a checkbox column; a floating bar offers the actions that apply to the selected rows. Wired on Pods, Workloads, Nodes, the cluster and namespace resource views, and custom resources. Deliberately not on Browse, CRDs, Namespaces or Helm.
  - Batch actions. Delete, Restart, Scale, Suspend/Resume, Cordon/Uncordon, and Drain for nodes, with a confirmation that lists the objects, a progress state, and a results dialog with Retry.
- Added +/- numeric stepper buttons to Scale modals for deployments and statefulsets.

### Fixed

- Deleting a Job or ReplicationController now also deletes its Pods, matching `kubectl delete`.
