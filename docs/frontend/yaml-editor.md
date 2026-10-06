# YAML Editor Contract

The shared YAML editor (`frontend/src/shared/components/yaml`) serves object
YAML, Helm manifests, Helm values, and future YAML create/edit flows.
Kubernetes policy and identity live outside it. Read, diff, apply, merge, and
live-object refresh belong to the workflow layer
([YAML editing](../architecture/yaml-editing.md); object-panel workflows in
`frontend/src/modules/object-panel`), routed through the documented
data-access/action boundaries.

## Rules

- Callers pass complete object identity; the editor never infers cluster, GVK,
  namespace, or name.
- Mode selection (read-only, editable draft, protected-range editing,
  diff/review) and protected ranges are caller policy. The editor exposes
  focused primitives for text, markers, keyboard handling, and diagnostics.
- Line wrapping defaults on; callers may expose the `lineWrapping` option as a
  user toggle.
- Register as an `editor` keyboard surface when the editor needs key ownership.
- Read-only editors stay focusable (content carries a tabindex): clipboard and
  select-all shortcuts route to the surface containing focus, so an
  unfocusable editor silently loses Cmd/Ctrl+C/A. Only an *editable*
  CodeMirror counts as an input for shortcut suppression (`isInputElement` in
  `frontend/src/ui/shortcuts/utils.ts`), so single-key app shortcuts still work
  in focused read-only editors.
- Clipboard semantics come from the Wails Edit menu (`menu:cut/copy/paste/
  selectAll` events), not browser defaults. Clipboard reads go through the
  Go-side `ClipboardGetText`; `navigator.clipboard.readText` is
  permission-gated in the WebView and fails silently.
- Select All sets the selection on editor state, not a DOM range: CodeMirror
  virtualizes long documents, so DOM ranges cover only the rendered viewport.
- Selection styling must match CodeMirror's focused-selection specificity
  (`&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground`
  in `core/codemirror/theme.ts`), or focused editors silently fall back to
  CodeMirror's hardcoded colors.

## Validation

Test read-only, editable, dirty, apply/error, and protected-range states as
relevant, and verify keyboard and focus manually.
