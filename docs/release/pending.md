### Added

### Changed

- YAML, Helm manifest, and Helm values views now share the same editor component, keeping search, copy/select-all, paste handling, and context-menu behavior consistent across those YAML surfaces.

### Fixed

- YAML editing now checks the same `patch` permission that the save path uses, shows the permission denial reason on the disabled edit action, and rejects edits to Kubernetes-managed `metadata.managedFields`.
- YAML post-save verification no longer warns when the live object only differs by generated Deployment/ReplicaSet revision annotations or `kubectl.kubernetes.io/last-applied-configuration`.
