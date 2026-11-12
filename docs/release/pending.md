### Added

- Support for batch operations.
  - Batch select on tables. A toolbar button turns on a checkbox column; a floating bar offers the actions that apply to the selected rows. Wired on Pods, Workloads, Nodes, the cluster and namespace resource views, and custom resources. Deliberately not on Browse, CRDs, Namespaces or Helm.
  - Batch actions. Delete, Restart, Scale, Suspend/Resume, Cordon/Uncordon, and Drain for nodes, with a confirmation that lists the objects, a progress state, and a results dialog with Retry.
- Added +/- numeric stepper buttons to Scale modals for deployments and statefulsets.
- Named workspaces. Save the arrangement of every app window and floating panel window under a name, and reopen it later.
  - File → Save Workspace… and Open Workspace…, or the same commands in the command palette.
  - A workspace keeps each window's position, cluster tabs, views, table filters, and docked and floating panels.
  - Opening a workspace replaces the current windows. Unsaved edits stop the switch, and saved clusters that are no longer available are listed.
  - Saved workspaces can be replaced, renamed, or deleted.

### Fixed

- Deleting a Job or ReplicationController now also deletes its Pods, matching `kubectl delete`.
