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

## Sidebar control handoff follow-up

The user clarified that arrow navigation within the list is correct; Tab must
reach and operate the other sidebar controls after a click. Native reproduction:
click Nodes → Tab focuses Hide Sidebar → Tab focuses Select namespace, without a
visible focus ring. Enter then returned focus to Nodes instead of opening the
namespace palette (CUA native focus overlay, 2026-09-10).

| Acceptance criterion | Status | Evidence |
| --- | --- | --- |
| Tab and Shift+Tab visibly traverse sidebar controls after a click | passed | Real Sidebar, KeyboardProvider, and AppRegionNavigation regression; five new cases failed before the fix (`/tmp/luxury-yacht-sidebar-red.log`). Browser CSS check failed with `focusVisible: false, outline: none`, then passed with `outline: solid, width: 2px`. Native screenshot showed the namespace button's blue outline after Tab |
| Enter/Space activate the focused sidebar control instead of a list item | passed | Native Enter and Space on Select namespace opened its palette; Escape restored the button; Shift+Tab then Enter on Hide Sidebar collapsed it. Sidebar restored with Cmd+B. Four regression cases prove those buttons' Enter/Space events remain unclaimed by list navigation |
| List arrows, region switching, focus restoration, and modal containment remain available | passed | Native click Nodes → Up focused Events → Tab focused Hide Sidebar; Control+Tab entered content and Control+Shift+Tab restored Hide Sidebar. Control+Tab stayed inside the namespace palette; Escape restored its invoking button. Focused related suites: 6 files / 95 tests (`/tmp/luxury-yacht-sidebar-coverage.log`). Debug overlay closed and sidebar visibility restored afterward |
| Coverage and changed-function complexity | passed | `mise exec -- wails3 task test:frontend-coverage`: exit 0, 518 files / 4,885 tests, 86.84% statements; SidebarKeys 92.01%, appFocusRegions 95.09% (`/tmp/luxury-yacht-sidebar-full-coverage.log`). Local Biome max-12 complexity check passed for both changed production modules |
| Final prerelease gate and latest diff review | passed | `GOCACHE=/tmp/luxury-yacht-go-build STATICCHECK_CACHE=/tmp/luxury-yacht-staticcheck mise exec -- wails3 task qc:prerelease`: exit 0, including 518 frontend files / 4,885 tests (`/tmp/luxury-yacht-sidebar-prerelease.log`). Final production diff inspected; `git diff --check` exit 0 |

The fix restricts list navigation to list entries (or the list's entry root), so
ordinary sidebar buttons retain native activation. Both local and cross-region
navigation use the same focus-indicator helper, following synchronous composite
focus redirects. The indicator selector matches the specificity of the
mouse-focus reset so a preceding pointer interaction cannot hide the ring.

## Remaining audit backlog

These items remain outside this navigation implementation. They are not claims
that the whole application is now keyboard-complete:

- Choose and implement access to row-internal links/actions without making each
  virtualized row a separate tab stop.
- Complete keyboard access to remaining hover-only status actions.
- Add keyboard paths for tab context menus and reordering.
- Provide keyboard object-map navigation and actions.
- Expand contextual help for those interactions after their designs are settled.

## All-region control handoff follow-up

Accepted scope: trace click → Tab/Shift+Tab → Enter/Space through every region
and its local keyboard owners; preserve Control+Tab region switching and native
editor Tab. The row-action interaction model and object-map design remain open.

Inventory: header/cluster tabs/favorites/application menu; sidebar; content
(GridTable filters, headers, body and pagination); dockable object, App Logs,
Diagnostics and Port Forwards panels; notifications; blocking dialogs/palette;
owned dropdown and context-menu portals; YAML, logs and terminal surfaces.

Shared contract: KeyboardProvider observes navigation modality before local
capture handlers, including modal traps, and owns visible focus and cleanup.
AppRegionNavigation retains region order/history; DockablePanel owns local panel
order. Composite list/tab handlers only activate their own focus target. Portal
controls own their Tab sequence and return focus to their invoking control.
No backend, resource identity, provider ordering or data contract changes.
The focus observer imports React only; consumers use the existing provider,
avoiding a layout ↔ shortcuts import cycle.

| Acceptance criterion | Status | Evidence |
| --- | --- | --- |
| Local handlers and browser-default Tab show focus after pointer use; stale indication clears on pointer/unmount | passed | New `useKeyboardFocusIndicator.test.tsx`, modal and dockable-panel regressions. The initial focused run had 11 failures before fixes (`/tmp/luxury-yacht-all-regions-red.log`). Rendered dropdown actions and modal controls showed a solid 2px outline after Tab. Native screenshots showed the namespace button and App Logs column resizer outline after pointer use |
| Clicking a control establishes the owner before its action opens a popup | passed | New observer regression failed before normalization (`/tmp/luxury-yacht-all-regions-click-focus-red.log`; the other two failures were fixture selectors). Latest observer run: 6 passed (`/tmp/luxury-yacht-all-regions-click-green.log`). Native click Favorites → Escape retained Favorites; Tab reached Command Palette while Diagnostics was open |
| Diagnostics does not steal outside Tab and retains its active view tab stop | passed | Outside-Tab and active-tab regressions in `DiagnosticsPanel.test.ts`; active-tab regression ran red (`/tmp/luxury-yacht-all-regions-diagnostics-tab-red.log`). Native header traversal worked with Diagnostics open; Shift+Tab from K8s API reached Close All, Tab returned to K8s API, Right/Enter selected Cluster Data. Enter on Maximize changed the button to Restore panel size; a second Enter restored size |
| App Logs reverse Tab follows the shared panel control order | passed | `AppLogsPanel.test.tsx` uses the actual DockablePanel and keyboard providers, mocking data and dropdown fixtures. Reverse Tab from the focused log body failed by reaching the text filter, then passed by reaching the preceding column resizer (`/tmp/luxury-yacht-all-regions-applogs-order-red.log`; final gate below). Native text-filter reverse Tab reached Log Levels; forward Tab reached auto-scroll, Copy, Clear and column resizers; Space toggled auto-scroll off and back on |
| Native click in the App Logs body followed by reverse Tab | blocked | The CUA coordinate-click API repeatedly returned `noWindowsAvailable` for the running development window, despite AX and screenshots working. Body-origin behavior is covered by the real-component regression above, but that is not native evidence. This specific native check remains unfinished |
| Dropdown action/bulk controls retain Enter/Space; menu Tab order and exit focus remain reachable | passed | Real Dropdown regressions ran red for action ownership, bulk disabled-control focus loss and searchable selection closure (`/tmp/luxury-yacht-all-regions-dropdown-state-red.log`). Latest related run: 8 files / 192 tests passed (`/tmp/luxury-yacht-all-regions-dropdown-state-green.log`). Rendered real Dropdown/provider fixture: Tab reached Up/Down actions, Enter/Space changed only action count; All/None changed selection and restored trigger focus before disabling themselves; closing resumed content traversal |
| Table and tab child controls retain their own activation | passed | New GridTable Enter/Space regressions ran red (`/tmp/luxury-yacht-all-regions-table-ownership-red.log`). Tests also retain positive row Enter behavior and suppress row ownership after pointer hover while a child is focused. Tabs tests cover Enter/Space on a nested close button; rendered real Tabs fixture confirmed Space closed that tab |
| Portaled controls retain region ownership and return to their invoking control | passed | New `appFocusRegions.test.tsx` portal regression ran red (`/tmp/luxury-yacht-all-regions-popup-ownership-red.log`). Rendered real provider/dropdown fixture: Control+Shift+Tab left the portal for sidebar and Control+Tab restored its content trigger. ContextMenu Tab/Shift+Tab/Escape restoration regressions ran red (`/tmp/luxury-yacht-all-regions-contextmenu-red.log`) and passed in the final gate |
| Favorites actions become visible on focus and retain their own keys | passed | Actual Favorites component tests cover Escape from an action and reorder-button key ownership with mocked data. Browser fixture using the production stylesheet and row structure failed with actions `display: none`, then passed with `display: flex` and Tab reaching the action. Native Favorites was empty; no real favorites were added, reordered or deleted |
| Header, sidebar, content, panels, notifications, dialogs and editor escape routes retain regional navigation | passed | Shared region/provider regressions passed in the full suite. Native: Nodes → Tab Hide Sidebar → Tab Select Namespace; Space opened the namespace palette, Control+Tab stayed inside and Escape restored the button. Content Tab traversed filter, metadata toggle, favorites/copy/export/columns, every sort/resize header and Data table. Diagnostics Control+Tab entered header and reverse restored its panel control without changing view. Unchanged notification/editor owners were reviewed as recorded below; their native workflows were not all repeated this turn |
| Full and directly affected statement coverage | passed | `mise exec -- wails3 task test:frontend-coverage`: exit 0, 519 files / 4,907 tests, 86.9% statements (`/tmp/luxury-yacht-all-regions-coverage.log`). Every changed production module exceeded 80% except two initial gaps. Added adjacent regressions raised interaction wiring to 90.74% and Favorites to 90.9% (55 files / 438 tests, `/tmp/luxury-yacht-all-regions-adjacent-coverage.log`). Reports retained under `/tmp/luxury-yacht-all-regions-coverage-report` and `/tmp/luxury-yacht-all-regions-adjacent-coverage-report` |
| Changed-function cognitive complexity | passed | Local Biome max-12 scan: changed/new functions pass (`/tmp/luxury-yacht-all-regions-complexity.log`). Five untouched functions exceed 12: ContextMenu render callback 16, DropdownBulkActions 13, DropdownOptionRow 14, AppLogs buildClusterOption 16 and log-filter callback 22. Read-only HEAD extraction reproduced those scores (`/tmp/luxury-yacht-all-regions-baseline/complexity.log`). No remote Sonar closure is claimed |
| Final prerelease and latest worktree review | passed | `GOCACHE=/tmp/luxury-yacht-go-build STATICCHECK_CACHE=/tmp/luxury-yacht-staticcheck mise exec -- wails3 task qc:prerelease`: exit 0, including backend/race checks, frontend typecheck/lint, 519 files / 4,910 tests, knip and vulnerability scans (`/tmp/luxury-yacht-all-regions-prerelease.log`). Post-gate production diff and new helpers inspected; `git diff --check` exit 0. Subsequent edits only update this evidence record |

The unchanged owner inventory distinguishes code review from native behavior:

- `AppMenuBar.tsx:92` owns menu arrows/activation; its trigger handler at line
  190 stops propagation before opening a section. Menu items remain outside the
  sequential Tab order. This pass did not reproduce a sibling-control activation
  problem in that implementation.
- `PortForwardsPanel.tsx:75` registers Escape and delegates panel navigation;
  `ErrorNotificationSystem.tsx:92` makes covered cards inert and line 183 marks
  the notifications region. `appFocusRegions.test.tsx:262` exercises notification
  reachability. No live port-forward operation or notification error was induced.
- `YamlEditor.tsx:592`, `ShellTab.tsx:398`, `LogViewer.tsx:2672` and
  `NodeLogsTab.tsx:1035` register editor/native-action owners. Their clipboard
  callbacks do not add a competing Tab/Enter walker. Existing editor-exemption
  and region tests ran in the full suite; shell commands, YAML edits and every
  resource-panel variant were not exercised natively in this follow-up.

Paths above are under `frontend/src`: application menu in `ui/layout`, port
forwards in `modules/port-forward`, notifications in `shared/components/errors`,
YAML in `shared/components/yaml`, and resource editors in
`modules/object-panel/components/ObjectPanel`.

Rendered checks used actual keyboard providers, Dropdown, Tabs and modal focus
trap with local fixture state. The Favorites CSS check used matching production
markup rather than the full data-backed Favorites menu. Temporary browser
fixtures were removed. These checks do not establish native shortcut delivery.
On macOS, table context menus use the OS menu, so the native menu attempt does
not validate the changed React ContextMenu fallback. CUA app-target key injection
could not reliably operate that OS menu; no destructive action was selected.

Native checks used the existing macOS Wails development session. A full frontend
reload was needed to replay the focus observer after hot updates. Cleanup was
confirmed: Overview restored, audit panels closed and focus overlay off. The
user's development session remains running. The direct App Logs body check above
is the remaining verification blocker; this record does not declare the whole
application keyboard-complete.
