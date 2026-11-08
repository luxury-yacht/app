### Changed

- Redesigned rollback and confirmations modals.
  - Rollback modal makes the current and rollback diffs clearer, and gives more horizontal space for comparison.
  - Confirmation modals show the object being acted on much more prominently.

### Fixed

- Closing a modal or the command palette no longer focuses keyboard control, causing an unexpected highlight of an element.
- Rolling back a Deployment no longer copies the `pod-template-hash` label into its pod template, and the label no longer appears as a change in the rollback diff.
