### Changed

- The Rollback dialog labels the Current revision and the revision to roll back to above a wider diff, and picks the revision from a dropdown instead of a list.
- Warning dialogs such as Delete, Restart, and Scale to 0 show the kind, name, namespace, and cluster of the object being acted on.

### Fixed

- Closing a modal or the command palette no longer focuses keyboard control, causing an unexpected highlight of an element.
- Rolling back a Deployment no longer copies the `pod-template-hash` label into its pod template, and the label no longer appears as a change in the rollback diff.
