Plan

- Add command palette entry for "Diff Objects" that opens a global modal (no specific cluster view required).
- Extend modal state in ViewState/ModalState contexts to track the diff viewer open/close state.
- Decide on a safe catalog data source for object selection that won’t interfere with Browse.
  - Preferred: add a new refresh domain backed by the object catalog so the diff viewer can query objects independently of Browse.
  - Update backend domain registration and frontend refresh types/orchestrator/diagnostics config accordingly.
- Build the ObjectDiffModal skeleton:
  - Render in AppLayout alongside other global modals.
  - Side-by-side layout with left/right object selectors, clear/reset actions, and status messaging.
  - Selection model includes cluster id, kind, namespace, name (allows cross-cluster comparisons).
- Populate selectors using the chosen catalog data source:
  - Filter to active clusters only.
  - Support search/filter by kind/namespace/name (reusing existing dropdown + search patterns).
- Fetch YAML for left/right selections using scoped object-yaml refresh:
  - Build scope from selected cluster id + object identity.
  - Enable/disable scoped domains on selection changes and cleanup on modal close.
  - Normalize YAML and strip metadata.managedFields + metadata.resourceVersion before display/diff.
- Render the side-by-side diff:
  - Compute line diff (reuse yamlDiff computeLineDiff) and render line numbers + add/remove highlights.
  - Handle empty selections, loading, error, and truncated diff states.
- Add focused frontend tests:
  - Command palette opens modal; modal open/close behavior.
  - Selection changes trigger YAML fetch and diff render.
  - Ignore managedFields/resourceVersion in display + diff.
  - Loading/error/truncation UI states.

Questions

- Where should the modal be opened from (menu item, command palette, object panel, or somewhere else)?
  - For now, just add a "Diff Objects" command to the Command Palette
- Should the diff be side-by-side only (left/right) or also allow a unified view?
  - Side by side only
- Any fields to ignore by default (e.g., metadata.managedFields, metadata.resourceVersion)?
  - Yes to both of those. Do not diff or even display those in the diff viewer.
