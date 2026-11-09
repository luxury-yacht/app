### Added

- Batch operations are now available in most views. Enable batch operations by clicking the icon in the toolbar. This will show a new row of checkboxes to the left of the objects. Select one or more objects, and a context-aware floating taskbar will appear with a selection of supported operations.
- Added +/- numeric stepper buttons to Scale modals for deployments and statefulsets.

### Fixed

- Deleting a Job or ReplicationController now also deletes its Pods, matching `kubectl delete`.
