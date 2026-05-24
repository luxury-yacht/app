# YAML Editor Component Plan

## Goal

Create a reusable `YamlEditor` component for YAML viewing and editing. The
component should centralize CodeMirror setup, search, selection/copy behavior,
context menu behavior, read-only mode, disabled editing, and future
protected-range rendering so object editing, object creation, and read-only YAML
surfaces use the same editor mechanics.

This plan is a prerequisite for the protected-field editor work in
`docs/plans/yaml-editor-field-policy.md`.

## Current Surfaces

The app currently has multiple YAML-like surfaces:

- `YamlTab` renders object YAML and owns CodeMirror plus live-object edit/save,
  reload/merge, drift, managedFields, and post-save behavior.
- `ManifestTab` renders Helm manifests with a read-only CodeMirror instance and
  duplicated search/editor setup.
- `ValuesTab` renders Helm values with a read-only CodeMirror instance,
  duplicated search/editor setup, and values-specific mode controls.
- `ObjectDiffModal` and `RollbackModal` render side-by-side diffs through
  `DiffViewer`, not single-document CodeMirror editors.

`YamlTab` is not reusable as an object-creation editor because it mixes the
editor surface with object-panel workflow state.

## Files

Add the shared component under frontend shared components:

- `frontend/src/shared/components/yaml/YamlEditor.tsx`
- `frontend/src/shared/components/yaml/YamlEditor.css`
- `frontend/src/shared/components/yaml/YamlEditor.test.tsx`
- `frontend/src/shared/components/yaml/index.ts`

Keep object-panel workflow helpers in the object-panel YAML folder. Do not move
live-object save, reload/merge, or validation behavior into the shared component.

## Component Contract

`YamlEditor` owns editor mechanics only:

- CodeMirror rendering
- YAML language mode and shared CodeMirror theme
- editable, view-only, and disabled modes
- search input/buttons and search keyboard integration
- editor context menu for copy, paste, cut when editable, and select all
- selection and copy behavior
- optional key bindings supplied by the caller
- optional caller toolbar actions
- optional protected-range decorations and transaction filtering
- local protected-edit feedback

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

## API

Use a controlled value API and a small imperative handle for workflows that need
focus or select-all behavior.

```ts
export interface ProtectedYamlRange {
  from: number;
  to: number;
  tooltip?: string;
  blockedMessage?: string;
}

export type ProtectedYamlRangeResolver = (value: string) => ProtectedYamlRange[];

export interface YamlEditorHandle {
  focus: () => void;
  selectAll: () => boolean;
  getSelectedText: () => string;
  getView: () => EditorView | null;
}

export interface YamlEditorProps {
  value: string;
  onChange?: (value: string) => void;
  editable?: boolean;
  disabled?: boolean;
  ariaLabel: string;
  active?: boolean;
  shortcutLabel?: string;
  shortcutPriority?: number;
  height?: string;
  className?: string;
  searchPlaceholder?: string;
  showSearch?: boolean;
  toolbarActions?: React.ReactNode;
  largeDocumentNotice?: string | null;
  extraExtensions?: Extension[];
  keyBindings?: KeyBinding[];
  protectedRanges?: ProtectedYamlRange[];
  protectedRangeResolver?: ProtectedYamlRangeResolver;
  protectedTooltip?: string;
  protectedBlockedMessage?: string;
  onProtectedEditBlocked?: (reason: string) => void;
  onEscape?: () => boolean;
  onCreateEditor?: (view: EditorView) => void;
}
```

Behavior:

- `editable={true}` allows text changes when `disabled` is false.
- `editable={false}` renders a view-only editor.
- `disabled={true}` suppresses editing commands while preserving selection,
  copy, cursor movement, and search.
- `onChange` fires only for accepted document changes.
- caller-provided `keyBindings` are appended after component-owned search/context
  behavior for focused-editor commands only.
- `toolbarActions` renders beside the search controls. Workflow actions such as
  managedFields toggle, save, cancel, reload/merge, or Helm values mode controls
  remain caller-owned.
- search works in editable, view-only, and disabled modes.

## Shortcut Ownership

`YamlEditor` owns editor-surface shortcut registration. Callers pass activation
and labels; callers do not separately call `useSearchShortcutTarget` or
`useKeyboardSurface` for the same editor.

Workflow wrappers still own workflow-level shortcuts with `useShortcut`. For
example, `YamlTab` must keep save/cancel shortcuts that work from the whole YAML
tab surface, including search input and toolbar focus. Do not move tab-level
`Mod-s` or Escape behavior exclusively into CodeMirror key bindings.

Required behavior:

- register `useSearchShortcutTarget` with `active`, `shortcutPriority`, and
  `shortcutLabel`
- register `useKeyboardSurface` with `kind: "editor"`, the editor root ref,
  `active`, and `shortcutPriority`
- handle native copy, select-all, and paste through the keyboard surface
- return false for paste when `editable !== true` or `disabled === true`
- call optional `onEscape` from the keyboard surface before global Escape
  shortcuts; callers use this for save/cancel workflows that need Escape
- do not register active search/native-action ownership when `active === false`

Default shortcut props:

- `active = true`
- `shortcutPriority = 30`
- `shortcutLabel = "YAML editor search"`

CodeMirror keymap precedence:

- component-owned `Mod-f` and `Shift-Mod-f` always focus editor search first
- caller `keyBindings` are placed after search bindings so callers cannot
  accidentally replace search behavior
- caller `keyBindings` are for focused-editor behavior only, not the sole owner
  of workflow commands that must work outside the CodeMirror focus target
- Escape is handled through `onEscape` and the keyboard surface contract; caller
  `keyBindings` should not provide a competing Escape binding. Workflow wrappers
  may still keep tab-level Escape shortcuts through `useShortcut`.
- when `disabled === true`, editing commands and focused-editor mutating commands
  must return false, but search/copy/select-all remain available

## Protected Ranges

`YamlEditor` should not know Kubernetes policy semantics. It accepts resolved
protected ranges and user-facing messages from the caller or a policy helper.

Use `protectedRangeResolver` for editable documents. Static `protectedRanges` are
allowed only for immutable/view-only documents or tests. The resolver must run
against the current document before filtering each transaction so ranges do not
drift after accepted edits outside protected blocks.

Protected-field visual treatment:

- faint cool-gray background on protected lines/blocks
- slightly muted but readable text
- thin left accent bar beside protected lines/blocks
- no lock icons, badges, chips, overlays, split panes, or hidden text
- cursor movement, selection, copy, and search continue to work

Default protected tooltip:

`Managed by Kubernetes. Shown for context and cannot be edited.`

Default blocked-edit message:

`Managed Kubernetes fields cannot be edited.`

Protected transaction behavior:

- type, paste, cut, delete, undo, and redo are rejected when the proposed change
  touches a protected range
- transaction filtering checks ranges from the pre-transaction document
- when a transaction is accepted, protected ranges are recomputed from the new
  document before the next transaction
- rejected transactions leave the document unchanged and call
  `onProtectedEditBlocked`
- selecting and copying protected text is always allowed

## Layout

`YamlEditor` should render a compact editor surface, not a page section:

- optional top search row when `showSearch !== false`
- search input on the left
- search action buttons next to the input
- caller `toolbarActions` on the right
- editor fills remaining height
- large-document notice renders directly above the editor when supplied

The component should use project CodeMirror helpers:

- `buildCodeTheme`
- `createSearchExtensions`
- `copyCodeMirrorSelection`
- `getCodeMirrorSelectedText`
- `selectCodeMirrorContent`

Do not duplicate those helpers in the component folder.

## Adoption Order

### Phase 1: Extract Shared Component

- [ ] Create `YamlEditor`
- [ ] Move shared CodeMirror YAML setup, appearance-mode theme handling, search,
      select-all, copy, paste, cut, and context menu behavior out of `YamlTab`
- [ ] Move `useSearchShortcutTarget` and `useKeyboardSurface` ownership into
      `YamlEditor` with explicit `active`, label, and priority props
- [ ] Update `YamlTab` to render `YamlEditor`
- [ ] Keep object-panel workflow state in `YamlTab`: refresh, edit capability,
      managedFields toggle, save/cancel, reload/merge, drift, validation, and
      post-save notices
- [ ] Keep `YamlTab` workflow-level `useShortcut` ownership for save/cancel so
      those commands still work from search input and toolbar focus
- [ ] Preserve existing YAML tab tests for search, shortcuts, context menu,
      editing, save/cancel, and disabled edit behavior

### Phase 2: Adopt Read-Only YAML Surfaces

- [ ] Update `ManifestTab` to use `YamlEditor` with `editable={false}`
- [ ] Update `ValuesTab` to use `YamlEditor` with `editable={false}` while
      keeping values mode controls in `ValuesTab`
- [ ] Pass each surface's existing shortcut priority and label during migration:
      `YamlTab` uses priority 30 with "YAML tab search", `ManifestTab` uses
      priority 20 with "Helm manifest search", and `ValuesTab` uses priority 20
      with "Helm values search"
- [ ] Keep Helm-specific loading, refresh, formatting, and mode-selection
      behavior outside `YamlEditor`
- [ ] Remove duplicated CodeMirror/search setup from those tabs after adoption

### Phase 3: Object Creation Readiness

- [ ] Add a creation workflow proof point that uses `YamlEditor` with
      `editable={true}`
- [ ] Confirm create-mode validation is supplied by the caller, not embedded in
      `YamlEditor`
- [ ] Confirm create-mode policy can allow `apiVersion`, `kind`,
      `metadata.name`, and `metadata.namespace` while still rejecting or stripping
      server-owned fields pasted into a new manifest

### Phase 4: Protected Range Integration

- [ ] Add protected-range decorations to `YamlEditor`
- [ ] Add protected-range transaction filtering to `YamlEditor`
- [ ] Use `protectedRangeResolver` for editable documents so offsets stay current
      after accepted edits
- [ ] Wire live-object edit protected ranges from the YAML field policy helpers
- [ ] Keep policy path resolution outside `YamlEditor`

### Phase 5: Diff Surfaces Decision

- [ ] Leave `ObjectDiffModal` and `RollbackModal` on `DiffViewer` unless they need
      single-document YAML viewing behavior
- [ ] Revisit only if a future UX needs synchronized CodeMirror panes, inline
      search within each side, or protected-field decorations inside diff panes

## Tests

Add focused tests for `YamlEditor`:

- renders value in view-only mode
- calls `onChange` in editable mode
- does not call `onChange` when `editable={false}`
- suppresses edits when `disabled={true}`
- search works in editable and view-only modes
- `useSearchShortcutTarget` ownership respects active/inactive state, label, and
  priority
- `useKeyboardSurface` native actions cover copy, select-all, paste, inactive-tab
  behavior, and disabled paste suppression
- context menu exposes copy/select all in view-only mode
- context menu exposes cut/paste only when editable and not disabled
- keymap precedence preserves `Mod-f` search, caller `Mod-s`, Escape through
  `onEscape`, tab-level save/cancel `useShortcut` behavior outside CodeMirror
  focus, and disabled-mode suppression
- caller key bindings run when enabled and do not run mutating commands while
  disabled
- toolbar actions render without being owned by the editor
- protected ranges render with the expected class names once implemented
- protected edit attempts leave the value unchanged and call
  `onProtectedEditBlocked` once protected ranges are implemented

Update adoption tests:

- `YamlTab` tests continue to cover object-panel workflow behavior
- `ManifestTab` tests verify read-only manifest display still works
- `ValuesTab` tests verify read-only values display and mode switching still work

## Validation

- [ ] `npm run test --prefix frontend -- YamlEditor YamlTab ManifestTab ValuesTab`
- [ ] `npm run typecheck --prefix frontend`
- [ ] `mage qc:prerelease` before non-documentation work is complete

## Completion Criteria

- `YamlEditor` is the only shared component responsible for single-document YAML
  CodeMirror setup.
- `YamlTab` uses `YamlEditor` without moving live-object workflow state into the
  shared component.
- `ManifestTab` and `ValuesTab` use `YamlEditor` for read-only YAML display.
- `ObjectDiffModal` and `RollbackModal` remain on `DiffViewer` unless a later
  design explicitly changes their diff UX.
- Object creation can reuse `YamlEditor` without depending on object-panel edit,
  drift, or reload/merge behavior.
