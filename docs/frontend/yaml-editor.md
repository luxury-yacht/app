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
- Line wrapping defaults on. Callers may expose the shared editor's
  `lineWrapping` option when their workflow needs a user-facing toggle.
- Keyboard behavior should register as an editor surface when it needs ownership.
- Read-only editors must stay focusable (the content carries a tabindex):
  clipboard and select-all shortcuts route to the surface containing the
  focused element, so an unfocusable editor silently loses Cmd/Ctrl+C/A. Only
  an *editable* CodeMirror counts as an input for shortcut suppression — see
  `isInputElement` in `frontend/src/ui/shortcuts/utils.ts` — so single-key app
  shortcuts keep working in focused read-only editors.
- Clipboard semantics come from the Wails Edit menu (`menu:cut/copy/paste/
  selectAll` events), not browser defaults. Clipboard *reads* must go through
  the Go-side clipboard (`ClipboardGetText`); `navigator.clipboard.readText`
  is permission-gated in the WebView and fails silently.
- Select All must set the selection on editor state, not a DOM range —
  CodeMirror virtualizes long documents, so DOM ranges cover only the
  rendered viewport.
- Selection styling must match CodeMirror's focused-selection selector
  specificity (`&.cm-focused > .cm-scroller > .cm-selectionLayer
  .cm-selectionBackground` in `core/codemirror/theme.ts`), or focused editors
  silently fall back to CodeMirror's hardcoded colors.
- Diff, apply, merge, and live-object refresh behavior belongs to the workflow
  layer, not the text editor core — see
  [../architecture/yaml-editing.md](../architecture/yaml-editing.md).
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
