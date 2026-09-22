# Panel group ownership

Implementation is in place; native tab drop and reorder validation remains
blocked. Keep this record until the remaining checks are resolved.

## Scope

The branch replaces tab leaders with group-owned sizing and controls, preserves
neighboring tabs' editing state, and adds placement previews for empty right and
bottom docks. It also corrects empty-dock size defaults and removes layout state
for retired floating groups.

Lasting contracts live in [dockable panels](../frontend/dockable-panels.md)
(ownership, reconstruction, sizing, previews, and content remounting) and
[tabs](../frontend/tabs.md#drag-rules) (drag admission and event ordering).
Cross-window draft transfer and a broader workspace-state rewrite are outside
this work's scope.

## Recorded validation

These results were recorded on 2026-09-21 for the panel implementation, before
the subsequent dependency-update commit. They are not validation of the current
branch tip.

| Area | Result and evidence |
| --- | --- |
| Automated checks | Prerelease gate passed, including backend race tests, lint, typecheck, bindings, 5,085 frontend tests, knip, and Trivy. The focused dockable/tab/window suite passed 357 tests. |
| Coverage and complexity | Full frontend statement coverage was 89.75%; the preview component measured 97.61%. Changed production files met the local complexity limit of 12. Local results do not establish remote Sonar closure. |
| Drafts and lifecycle | [Lifetime tests](../../frontend/src/ui/dockable/DockablePanel.lifetime.test.tsx) cover neighboring-tab changes, unsaved-change guards, and content-error isolation. [Object context tests](../../frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanel.groupContext.test.tsx) cover originating context. Native calls and backend reads are mocked where applicable. |
| Sizing and drag admission | [Store tests](../../frontend/src/ui/dockable/panelLayoutStore.test.ts) cover empty-dock defaults and retired layouts. [Drop-target tests](../../frontend/src/ui/dockable/DockablePanelDropTargets.test.tsx) cover admission, cancellation, event ordering, preview geometry, and external transfer requests. |
| Browser interaction | Actual dock components in an ephemeral fixture passed right → bottom → right pointer drops, matching preview/result bounds, edge switching, cleanup, hit-testing, and light/dark inspection. This did not exercise the Wails transfer handshake. |
| Native macOS interaction | Earlier checks recorded draft retention, dirty guards, resize, maximize/restore, group docking, float/dock-back, and native window closure. Successful native tab drops and reorders were not observed. |

Latest retained logs: `/private/tmp/dock-preview-prerelease-final.log`,
`/private/tmp/dock-preview-coverage-final.log`,
`/private/tmp/dock-preview-focused-final.log`, and
`/private/tmp/dock-preview-complexity.log`.

### PR 361 follow-up

On 2026-09-21, the local worktree based on `d9e7654e` replaced the interactive
resize separators with native size controls and the group wrapper with a
nonmodal dialog. It also corrected the status-test fixture's focus cleanup.
The new size-control cases and resize Tab-order assertion failed before their
fixes. The final focused run passed 48 tests; full frontend coverage passed
5,087 tests, with 89.76% overall statements and 94.32% for `DockablePanelGroup`.
The changed production file passed the local complexity limit of 12.
The prerelease gate passed on this worktree, including all 5,087 frontend tests;
the post-gate diff check passed.

Browser checks passed right/bottom pointer and keyboard resizing and size bounds.
Native macOS checks passed Tab access, right pointer resizing, right/bottom
keyboard resizing, maximize/restore, dock-to-bottom, Float, and dock-back.
A native tab drop into an empty bottom dock left placement unchanged.
The temporary development server was stopped; port 9245 had no listener.

Evidence: `/private/tmp/pr361-final-focused.log`,
`/private/tmp/pr361-coverage-final.log`, `/private/tmp/pr361-coverage-summary.log`,
`/private/tmp/pr361-complexity-final.log`, `/private/tmp/pr361-prerelease.log`,
and `/private/tmp/pr361-ui-checks.md`.
The Sonar audit recorded five accessibility findings in
`/private/tmp/pr361-sonar-before.log`; closure awaits analysis after a push.

## Remaining checks

- [ ] Reorder tabs in the native app and move a tab between occupied docks.
- [ ] Drop into empty right and bottom docks in the native app; verify placement,
  preview size, and cleanup after dropping or cancelling.
- [ ] Drop between same-cluster workspace and panel windows, including an empty
  destination dock. Verify the active view, destination acknowledgement, and
  closure of a native source only after its final tab transfers. Confirm that
  incompatible clusters reject the drop.
- [x] Run `mise exec -- wails3 task qc:prerelease` on the final implementation
  worktree. Rerun after further production changes.
- [ ] Confirm Sonar closure after the remediation is pushed and analyzed.

Native drag attempts have returned `noWindowsAvailable` or left placement or
order unchanged. These outcomes do not establish whether the
limitation is in automation or the app; manual success has not been recorded.
Browser and mocked-native checks cannot close this gap. Windows and Linux UI
checks have not been run.

Record remaining results with the tested revision and platform in the task or
PR, then delete this temporary plan before merge. Keep lasting guidance in the
linked frontend documents.
