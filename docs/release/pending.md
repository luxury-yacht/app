### Added

### Changed

- YAML, Helm manifest, and Helm values views now share the same editor component, keeping search, copy/select-all, paste handling, and context-menu behavior consistent across those YAML surfaces.
- Existing-object YAML edit mode now shows Kubernetes-owned fields such as `resourceVersion` and `status` in context as read-only protected YAML instead of hiding them from the draft. `managedFields` follows the existing toolbar toggle when entering edit mode.

### Fixed

- YAML editing now checks the same `patch` permission that the save path uses and shows the permission denial reason on the disabled edit action.
- YAML editing blocks changes to protected Kubernetes-owned fields in the editor with a local message, while the backend still rejects protected-field bypass attempts.
- YAML post-save verification no longer warns when the live object only differs by protected server-owned fields, generated Deployment/ReplicaSet annotations, or `kubectl.kubernetes.io/last-applied-configuration`.
