### Added

### Changed

### Fixed

- The Pods tab for a Deployment could show "No pods found" even though pods were running, depending on data-arrival order when connecting to a cluster. Pod ownership is now re-resolved when the missing piece (the ReplicaSet) arrives, so the tab fills in immediately.
- With several panels of the same kind open at once (for example two Deployments), closing one could silently stop the other's Details and Events from auto-refreshing. Each panel now tracks its refresh independently. This also removes the "Refresher ... is already registered" console warning.
