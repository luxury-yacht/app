# YAML Editor

`YamlEditor` is the shared single-document YAML viewing and editing surface.
Use it for YAML text that should behave like an editor, including object YAML,
Helm manifests, Helm values, and future object-creation manifests.

## Location

The shared component lives in:

- `frontend/src/shared/components/yaml/YamlEditor.tsx`
- `frontend/src/shared/components/yaml/YamlEditor.css`
- `frontend/src/shared/components/yaml/YamlEditor.test.tsx`
- `frontend/src/shared/components/yaml/index.ts`

## Ownership

`YamlEditor` owns editor mechanics only:

- CodeMirror rendering
- YAML language mode and shared CodeMirror theme
- editable, view-only, and disabled modes
- search input/buttons and search keyboard integration
- editor context menu for copy/select-all, plus cut/paste when editable
- native copy, select-all, and paste handling through keyboard surfaces
- optional caller key bindings for focused-editor behavior
- optional caller toolbar actions
- protected-range decoration and transaction filtering

`YamlEditor` must not own workflow state:

- object refresh subscriptions
- Kubernetes object identity
- capability checks
- save/apply/create/delete calls
- reload/merge or drift detection
- post-save verification/diff notices
- managedFields viewing policy
- Helm values mode selection
- modal fetch/rollback actions

Workflow wrappers such as `YamlTab`, `ManifestTab`, and `ValuesTab` pass values,
mode flags, labels, priorities, toolbar actions, and callbacks into
`YamlEditor`.

## Modes

Use `editable={true}` only when the caller owns a draft and can accept edits.
Use `editable={false}` for view-only YAML. Use `disabled={true}` when the editor
is temporarily non-mutating, such as during save; disabled mode must preserve
selection, copy, cursor movement, and search.

`onChange` fires only for accepted document changes. The component should reject
mutating behavior while disabled or view-only, including native paste and context
menu cut/paste.

## Shortcut Ownership

`YamlEditor` registers the editor surface with `useKeyboardSurface` and the
search target with `useSearchShortcutTarget`. Callers must pass the active-tab
contract explicitly:

- `active`
- `shortcutLabel`
- `shortcutPriority`

Preserve existing per-surface priorities when migrating callers. Current YAML
surfaces use:

- `YamlTab`: priority `30`, label `"YAML tab search"`
- `ManifestTab`: priority `20`, label `"Helm manifest search"`
- `ValuesTab`: priority `20`, label `"Helm values search"`

Workflow-level shortcuts stay in the workflow wrapper. For example, `YamlTab`
owns save/cancel shortcuts through `useShortcut` so those commands still work
from search input and toolbar focus. Do not move workflow commands exclusively
into CodeMirror key bindings.

`YamlEditor` may accept caller `keyBindings`, but those bindings are for
focused-editor behavior only. Component-owned search bindings take precedence.

## Protected Ranges

`YamlEditor` does not know Kubernetes policy semantics. It accepts resolved
protected ranges and user-facing messages from the caller or a policy helper.

Use `protectedRangeResolver` for editable documents. Static `protectedRanges`
are appropriate only for immutable/view-only documents or tests. The resolver
runs against the pre-transaction document before filtering changes so offsets
stay valid after accepted edits outside protected blocks.

Protected-field visual treatment is intentionally plain:

- faint cool-gray background on protected lines or blocks
- slightly muted but readable text
- thin left accent bar beside protected lines or blocks
- no lock icons, badges, chips, overlays, split panes, or hidden text

Cursor movement, selection, copy, and search must continue to work inside
protected ranges.

Any transaction that touches a protected range is rejected as a whole. This
includes type, paste, cut, delete, undo, redo, select-all delete, and
whole-object replacement. Rejected transactions leave the document unchanged and
call `onProtectedEditBlocked`.

## Diff Surfaces

`ObjectDiffModal` and `RollbackModal` use `DiffViewer`, not `YamlEditor`.
Revisit that only if a future design needs single-document YAML editor behavior,
synchronized CodeMirror panes, inline search in each side, or protected-field
decorations inside diff panes.

## Tests

Add or update focused `YamlEditor` tests when changing shared editor mechanics.
Workflow wrappers should keep their own tests for workflow behavior, such as
object save/cancel, Helm values mode switching, loading states, permissions, and
post-save notices.
