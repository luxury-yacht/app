# Keyboard control

The original request was an audit of complete keyboard access, predictable focus,
and discoverable actions. Implementation was paused for design review. On
2026-09-10 the user selected the navigation model below and then authorized its
implementation with “do it.” This phase implements that model and the related
focus defects. The remaining audit backlog is listed separately below.

## Selected model

| Keys | Behavior |
| --- | --- |
| Tab / Shift+Tab | Next / previous control within the current region |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous visible region |

Control is literal on every platform. Region order is header (including cluster
tabs), sidebar (including resize), content, visible panels, then visible error
notifications. Navigation wraps and restores the last available focused control.
It preserves active cluster, object, and view selection. Surfaces marked
`data-tab-native="true"` retain native Tab handling; Control+Tab leaves the
region. Blocking surfaces retain focus.
F6/F2 navigation and an explicit row-interaction mode were not selected.

Durable guidance is in [the keyboard contract](../frontend/keyboard.md).

## Ownership and sequencing

`KeyboardProvider` captures region commands before editor/panel Tab handlers,
while an active blocking surface prevents background region switching. Plain Tab
first goes through local surfaces, then the registered app-region fallback.
`AppRegionNavigation` mounts in workspace and native panel renderers, below their
keyboard provider. Its focus history is local to that mounted renderer and uses
weak root references; unmount removes its focus listener and registrations.

Panel entry uses `focusPanelById`, which raises the panel. It deliberately avoids
`DockablePanelProvider.focusPanel`: that command activates a tab and schedules
focus to its header, overriding restored control focus. The existing provider
focus-in listener records the group. No new provider dependency is introduced.
See `ui/dockable/DockablePanelProvider.tsx`, `useDockablePanelState.ts`, and
`ui/layout/appFocusRegions.ts` under `frontend/src`.

`useShortcuts` group activation gates each member's availability. Its affected
consumers are tables, the command palette, application menu shortcuts, object
panel tabs, and region navigation. Registration effects publish committed state
and remove obsolete registrations. Real provider/table tests cover blur/refocus.

Table filters, the separate header, and body retain DOM order at boundaries.
Native macOS testing exposed WebKit skipping sortable header buttons during
default Tab navigation. Region navigation now explicitly advances focus for
interior controls as well as boundaries; a regression test was run red before
the correction, then green, and the native sort/resize sequence was repeated.
The command palette uses the shared modal focus trap and a body portal, so
background inertness and focus restoration use the existing modal owner.
Error notification controls under covered stack cards are inert.

## Completion evidence for this phase

| Acceptance criterion | Status | Evidence |
| --- | --- | --- |
| Table paging/menu ownership follows focus and refocus | passed | `GridTable.keyboard.test.tsx` through the real table/provider; full frontend coverage run below |
| Table filter/header/body traversal in both directions | passed | Playwright against the real GridTable and providers, repeated after the final focus correction: populated/empty × header shown/hidden; all four combinations passed full forward/reverse traversal, wrapping, region escape, and restoration |
| Typed punctuation and native editing do not open global help | passed | `context.test.tsx`; full frontend coverage run below |
| Palette traps Tab and restores invoking focus | passed | `CommandPalette.keyboard.test.tsx`; native macOS palette kept its combobox focused for Tab, Shift+Tab, Control+Tab, and Control+Shift+Tab, accepted `?` as search text, and restored the YAML editor on Escape |
| Tab stays local; Control+Tab cycles regions in both directions | passed | `appFocusRegions.test.tsx`; real dockable-provider test in `DockablePanel.test.tsx`; native focus overlay showed header → sidebar → content and reverse restoration |
| Hidden/removed controls, empty regions, editors, blocking surfaces | passed | `appFocusRegions.test.tsx`, `useModalFocusTrap.test.tsx`, and the four rendered table cases |
| Notification controls remain reachable without focusing covered cards | passed | `appFocusRegions.test.tsx` and `ErrorNotificationSystem.test.tsx` |
| Shortcut discovery includes both region directions and local Tab | passed | Actual registration metadata checked in `appFocusRegions.test.tsx`; native shortcut help displayed Control+Tab and “Focus next region”; Control+Tab kept help open and Escape dismissed it |
| Native populated table, object-panel, palette, help, and panel-window focus workflows | passed | Native macOS workspace: filter → controls → Sort by Kind → Resize Kind, reverse to Sort; keyboard-opened object panel; panel control restoration without changing selected Details; leaving and restoring YAML editor. Separate native panel window: header → object tab → Details focus, reverse to header, then Details restored while YAML remained selected. Palette/help results above |
| Full frontend coverage | passed | `mise exec -- wails3 task test:frontend-coverage`: exit 0, 518 files / 4,880 tests, 86.84% statements (`/tmp/luxury-yacht-keyboard-coverage.log`). Changed measured production files range 80.51–100%; region hook 94.89%. Focused coverage after the final local-focus correction: component 100%, hook 94.89%, GridTableKeys 88.37% (`/tmp/luxury-yacht-keyboard-final-focus-coverage.log`). AppLayout mounting was exercised natively rather than imported in coverage |
| Changed-function cognitive complexity | passed | Local Biome with max 12: touched functions pass after refactoring. Existing untouched AppLogs `buildClusterOption` and log-filter callback remain 16/22; no Sonar analysis of an unpublished revision is claimed |
| Prerelease and latest diff review | passed | `GOCACHE=/tmp/luxury-yacht-go-build STATICCHECK_CACHE=/tmp/luxury-yacht-staticcheck mise exec -- wails3 task qc:prerelease`: exit 0 on the final production worktree, including backend race checks, frontend typecheck/lint, 518 test files / 4,880 tests, knip, and vulnerability scans (`/tmp/luxury-yacht-keyboard-prerelease.log`). An earlier gate exposed a formatter-induced indexOf argument type error; corrected before this passing run. Post-gate diff inspected; `git diff --check` exit 0 |

Automated tests mock native integration at the desktop/data boundary. Browser
checks used fixture rows and real rendering/keyboard providers; they do not prove
native shortcut delivery. Native checks use the development Wails window and its
focus-debug overlay. Development hot updates caused an application error;
reloading restored the running app before native checks. During cleanup, docking
the test panel closed the child window; subsequent computer-control attempts to
reselect the main window timed out. Restoring the prior workspace view and
turning off its focus overlay could not be confirmed. The development session
was stopped with an interrupt and exited 0. This is a cleanup limitation, not
evidence that docking or the main window failed. Native keyboard evidence above
is macOS-only.

## Remaining audit backlog

These items remain outside this navigation implementation. They are not claims
that the whole application is now keyboard-complete:

- Choose and implement access to row-internal links/actions without making each
  virtualized row a separate tab stop.
- Complete keyboard access to hover-only favorites/status actions.
- Add keyboard paths for tab context menus and reordering.
- Provide keyboard object-map navigation and actions.
- Expand contextual help for those interactions after their designs are settled.
