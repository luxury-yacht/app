# YAML Editor Contract

The shared YAML editor supports object YAML, Helm manifests, Helm values, and
future YAML creation/edit flows. Kubernetes policy and identity live outside the
editor.

## Agent Contract

- Use the shared YAML editor components for YAML viewing/editing surfaces.
- The editor must receive complete object identity from its caller; it must not
  infer cluster, GVK, namespace, or name.
- Protected ranges and read-only modes are caller policy, not Kubernetes
  semantics embedded in the editor.
- Keyboard behavior should register as an editor surface when it needs ownership.
- Diff, apply, merge, and live-object refresh behavior belongs to the workflow
  layer, not the text editor core.
- Do not route YAML reads or applies around the documented data-access/action
  boundaries.

## Ownership

- Shared editor components: `frontend/src/shared/components/yaml`
- Object-panel YAML workflows: `frontend/src/modules/object-panel`
- Backend object YAML read/apply paths: `backend/object_yaml*.go`
- Data reads: [../architecture/data-access.md](../architecture/data-access.md)
- Object identity: [../architecture/shared-resource-model.md](../architecture/shared-resource-model.md)

## Modes

- Read-only view.
- Editable draft.
- Protected-range editing.
- Diff/review surface.

Mode selection is workflow-owned. The editor should expose focused primitives
for text, markers, keyboard handling, and diagnostics.

## Change Checklist

When changing YAML behavior:

1. Preserve complete `clusterId` and GVK identity.
2. Decide whether the change belongs in shared editor UI or a workflow wrapper.
3. Confirm shortcut ownership and native editor behavior.
4. Test read-only, editable, dirty, apply/error, and protected-range states as
   relevant.

## Validation

Run targeted YAML editor/object-panel tests and typecheck. For editor behavior,
verify keyboard and focus manually.
