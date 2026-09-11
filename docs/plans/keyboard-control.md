# Keyboard control: completion and review record

The historical Actions-button and 2.4rem-padding evidence below is superseded by
the explicitly approved removal recorded at the end of this document.

The accepted interaction model is Tab/Shift+Tab within a region and physical
Control+Tab/Control+Shift+Tab between regions, including on macOS. Region movement
does not select another cluster, object or view. The earlier F2/F6 proposal was
not selected. Durable behavior lives in [keyboard.md](../frontend/keyboard.md),
[tabs.md](../frontend/tabs.md), [gridtable.md](../frontend/gridtable.md),
[dockable-panels.md](../frontend/dockable-panels.md), and
[object-map.md](../workflows/object-map.md).

This record was condensed on 2026-09-10 after independently checking the PR #344
review against head `1528b95ffd96c99a46927b527f2781876514af04`. The worktree was
clean at the start. It retains acceptance evidence and outstanding platform
limits rather than duplicating the durable contracts or relying on temporary
logs as the only explanation. That follow-up was subsequently committed and
pushed as `6848f5aa66a4c0b6fabef3ca1c72ade854753f47`, the head checked in the
re-review below.

## Reviewer assertions and disposition

Source paths below are under `frontend/src` unless otherwise noted.

| Assertion | Assessment and disposition |
| --- | --- |
| Clicking an action pins a hover status popover open | Confirmed by a new failing real-provider test in `shared/components/status/StatusIndicator.test.tsx`. `useTooltipKeyboard` treated all portal focus as keyboard entry. It now sets that flag only on keyboard entry; hover dismissal uses the shared close path to restore focus before removing a focused action. Existing keyboard-open persistence remains covered |
| Connectivity lacks a closing signal, while Sessions supplies one | Confirmed: `ui/status/ConnectivityStatus.tsx` supplies actions without `closeSignal`; a search of status consumers finds the signal only in `SessionsStatus.tsx`. Adding per-consumer signals would not repair the shared pointer/keyboard distinction |
| Multi-select option clicks strand list keys and typing | Confirmed by failing searchable/non-searchable Dropdown tests. Selection now returns focus to the search field or trigger. The Only action does this even when already the sole selection, without issuing another change. The suggested broader key guard was not adopted: it would leave typing outside the search field and conflict with the documented virtual-focus owner |
| Every existing Dropdown key test targets only trigger/search | Overstated: existing action-control and bulk-action tests dispatch keys to their buttons. They did not cover ordinary option click followed by list keys or typing; the new regressions cover that missing sequence |
| Object-map node menus can exceed the viewport | Confirmed: `objectMapNodeMenuItems.ts` emits an item for each connection edge, and ObjectMap supplies that list for both pointer and keyboard opening. A rendered 80-item menu extended beyond a 1,000px viewport. Shared ContextMenu now caps height using the app zoom factor, scrolls, and brings the highlighted item into view. Offscreen items were still present in the keyboard model; the reproduced defect was their visibility |
| Release notes are missing and Ctrl+Alt+Arrow panel cycling was removed | Confirmed by the branch diff and the deleted `usePanelSurfaceCycling.ts`. Added the new navigation model and keyboard access to `docs/release/pending.md` |
| Header focus markers and two scope priorities have no consumers | Confirmed by repository searches: only attribute producers/test fixtures remained, and APP_LOGS_PANEL/DIAGNOSTICS_PANEL had no references. Removed those attributes, their obsolete assertion/setup, and the two constants. Functional header/sidebar navigation tests remain |
| The plan's previous Sonar-pending statement is stale | Confirmed. The live all-rule audit reports zero open/confirmed new-code issues for reviewed head 1528b95f. GitHub reports SonarCloud and all listed CodeQL jobs successful; the review's still-running Go job has since completed |
| The entire plan can be deleted | Not adopted while validation limits remain. Lasting guidance is already in the owning docs linked above; this shorter record retains the review decisions, reproducible checks and remaining verification without the earlier temporary-log inventory |
| Tabs reserve 2.4rem inside a 200px maximum | Padding is confirmed and retained to avoid labels moving under the two overlay controls. The stated effective maximum is incorrect: the sizing rule overrides the older 200px rule with 240px. Rendered measurement was 240px wide with 38.4px right padding. Global/non-action tabs do not receive the menu modifier |
| Inaccessible manually saved namespaces always show Remove | Confirmed and intentional: their namespace button is disabled, so it cannot reveal Remove through row focus. The sibling Remove button must remain available for Tab. `ui/layout/Sidebar.tsx` limits removal to entries in the saved scope and excludes All Namespaces |
| Click focus can scroll a partly hidden control | Confirmed that the observer used bare `focus()`; an actual native scroll jump was not independently reproduced. Pointer normalization now requests `preventScroll`, with a provider regression proving that option is passed while focus still precedes activation |
| Nested tab buttons/status semantics can be hidden from accessibility tools | The structure was confirmed. Tab actions now sit beside the tab-role element within the same visual shell; status announcements sit outside their trigger button. Failing structural regressions cover both. Native macOS AX now lists Actions and Close separately, and browser accessibility snapshots give the tab only its label. Spoken screen-reader output remains untested |
| Windows/Linux Control+Tab delivery is unverified | Still unverified: this host provides macOS native validation. A search of the backend menu sources found no Tab accelerator, which does not prove OS/webview delivery on other platforms |
| The local complexity check has eight findings outside changed code | Eight findings were reproduced. Parsing the reported functions and comparing their body text to origin/main confirmed that all eight bodies were unchanged. Our scan checked 44 modules; the review reported 43 without its exact selection command, so that difference alone does not establish a reviewer error. The follow-up's modified/new functions passed max 12; three unchanged findings remained in its touched files |
| The branch replaces duplicate navigation owners and preserves identity | Source review confirms removal of the Diagnostics, App Logs, sidebar and panel-cycle handlers in favor of the shared model. ObjectMap still gates resource actions with `hasCompleteObjectMapReference`; `useObjectPanel` passes clusterId with focus requests. The branch contains frontend/documentation changes only. Tests provide separate evidence for behavior; these source observations do not alone establish every runtime path |
| The reviewer's gate passed and its worktree stayed clean | Its historical invocation cannot be independently reconstructed from the pasted report. This follow-up reruns the required gate and records its own result below. Initial worktree cleanliness was independently observed |

The semantic fix follows the [W3C rule for elements with presentational
children](https://www.w3.org/WAI/standards-guidelines/act/rules/307n5z/).
The tab element retains its drag markers and geometry; the new unpositioned
shell does not replace the tab strip as its offset parent. The existing object
panel control enumerator now includes the shell's sibling actions. No new
provider, lifecycle ordering, resource mutation or backend boundary was added.

## Acceptance evidence for the follow-up

| Criterion | Status | Evidence |
| --- | --- | --- |
| Pointer/keyboard ownership, cancellation and focus recovery | passed | New failing cases in StatusIndicator, Dropdown, ContextMenu, Tabs and useKeyboardFocusIndicator tests ran before their fixes. Focused runs passed 95 tests for shared controls, 98 for tabs/status/cluster/dockable consumers, and 49 for Dropdown including the already-selected Only case. The full suite below supersedes those intermediate totals |
| Rendered popover/dropdown/menu behavior | passed | Standalone Playwright used actual components, KeyboardProvider, AppRegionNavigation and production CSS, mocking only ZoomContext and using local data/actions. Hover → action click → leave closed the popover and restored its trigger. Option click returned to search; typing Gamma worked and Enter selected the highlighted option. The 80-item menu fit from y=10 to y=990 in a 1,000px viewport at 100% and 200% zoom; reverse arrow made item 79 visible and Enter invoked it |
| Rendered tab layout and semantics | passed | Actual Tabs and CSS: 240px tab width, 32px height, action button x=206/width=16 inside the reserved area; the tab's offset parent remained the strip. Tab → Actions → Enter invoked the menu callback; the next Tab reached Close. Browser AX showed separate named controls. Native screenshots retained the cluster/object tab layout |
| Native focus and adjacent workflows | passed | Fresh macOS Wails development window: cluster Tab → Actions → Enter opened its menu; Escape then Tab reached Close. Browse kind-option click → typing custom left focus in search; list-key activation worked, then All restored the original 669 rows and Escape restored Kinds. Connectivity keyboard entry reached Refresh Now, activation and forward/reverse Tab worked, and Escape restored Connectivity. A node opened from its table; its object-tab Actions menu, Close and Details order worked through the real panel consumer. The audit panel was closed and Overview restored |
| Full frontend coverage and affected modules | passed | `mise exec -- wails3 task test:frontend-coverage`: exit 0; 519 files / 4,948 tests; 87.14% statements. Affected modules: ContextMenu 90.38%, Tooltip 90.64%, Dropdown 94.60%, StatusIndicator 90.90%, Tabs 89.21%, useTooltipKeyboard 98.33%, DockablePanel 92.21%, AppHeader 98.21%, priorities 100%, useKeyboardFocusIndicator 97.22%. Generated reports were moved outside the frontend before lint |
| Changed-function cognitive complexity | passed | Local Biome limit 12 check of all ten touched production modules found no changed/new function above 12. Existing DropdownBulkActions 13, DropdownOptionRow 14 and DockablePanel handleClose 14 are unchanged from both reviewed HEAD and origin/main; thresholds and suppressions were not changed |
| Final prerelease and post-gate inspection | passed | `GOCACHE=/tmp/luxury-yacht-go-build STATICCHECK_CACHE=/tmp/luxury-yacht-staticcheck mise exec -- wails3 task qc:prerelease`: exit 0, including Go vet/staticcheck/race, binding validation, frontend lint/typecheck, 519 files / 4,948 tests, Knip and Trivy. Biome reported no fixes applied. Post-gate status and production diff inspection found only the intended 26 modified files; `git diff --check` passed |
| Sonar/CI for reviewed head | passed at 1528b95f | Live `mise exec -- npm run sonar:audit --prefix frontend -- --pull-request 344` returned zero issues; `gh pr view 344 --json headRefOid,statusCheckRollup` matched 1528b95f and successful Sonar/CodeQL results. The later 6848f5aa audit is recorded below; this historical result does not establish its Sonar state |
| Cross-platform and spoken screen-reader validation | pending | Windows/Linux native shortcut delivery and VoiceOver/NVDA spoken output were not exercised. macOS AX exposure and keyboard delivery are the evidence above; neither substitutes for those checks |

The test fixtures mock data/backend boundaries; native checks used connected,
read-only cluster navigation. No Kubernetes mutation, namespace-scope edit or
cross-window tab transfer was performed. Browser-only fixtures were removed.

During a hot update, the development window hit “Panel publication requires
WorkspacePanelSync” in React refresh. A full reload recovered; the final native
object-tab checks used the reloaded app. The publication provider was not changed
in this follow-up. This observation is not evidence about a release build.

Local diagnostic artifacts for this run use `/tmp/luxury-yacht-review-` names:
`red.log`, `dropdown-red.log`, `semantics-red.log`, `only-red.log`,
`coverage.log`, `coverage-report`, `complexity.log`,
`complexity-body-check.log`, `head-complexity.log`, `sonar.log`, `pr.json`,
`native-dev.log`, `prerelease.log`, and `tabs.png`. The summaries and test names above remain
readable without those machine-local files.

## Re-review at 6848f5aa

The working tree was clean at the start of this re-review. Assertions below
were checked independently against the current source, tests and remote checks.

| Assertion or acceptance criterion | Result and evidence |
| --- | --- |
| Columns option toggles become unwanted Tab stops | Confirmed by two failing Dropdown regressions, with and without search. The action-row toggle now has `tabIndex={-1}`. Tab and reverse Tab move between row actions, while arrows and Enter keep selection on the list's focus owner. Space toggles from the non-searchable trigger; inside search it remains text input. The tests passed after the fix |
| Columns consumers | `GridTableFiltersBar.tsx` and `FavSaveModal.tsx` both pass the shared `useGridTableColumnOptionRows` renderer. Native Nodes currently exposes one Reorder handle per column, with Up/Down keyboard instructions, rather than two separate buttons. The regression also covers custom rows with two trailing actions |
| Stale separator selector | Confirmed and updated to `.tab-item-shell:not(:last-child) > .tab-item::after`. It still only overrides height, top and colour; shared CSS owns separator content and visibility |
| Earlier six fixes and tab-wrapper consumers | Source checks retain keyboard-only popover persistence, shared focus-restoring dismissal, option/Only focus recovery, zoom-aware context-menu scrolling, release notes and removed obsolete navigation markers. Cluster tab widths still sum tab rectangles, drop targets query descendants, panel focus order deduplicates elements, and globally loaded `.sr-only` remains absolutely positioned. These are source checks, not new proof of native cross-window dragging |
| Complexity count | The old claim that the reviewer's count was wrong has been removed. Selecting `git diff --name-only --diff-filter=ACMR origin/main...REV`, retaining `.ts`/`.tsx` and excluding `.test.`, `.spec.` and `.stories.`, yields 44 files at 1528b95f and 46 at 6848f5aa with base 2fa14618. That reproduces our inventory, not the reviewer's unstated selection command. Exact inventories are in `/tmp/luxury-yacht-rereview-counts.json` |
| Changed-function complexity | Passed max 12 for the changed status component, option-row renderer and extracted group-header renderer. The group-header extraction keeps the touched row renderer within the limit. The unchanged DropdownBulkActions function still reports 13; no threshold or suppression changed |
| Native dropdown behavior | macOS Wails Nodes → Columns → Tab focused Reorder Kind, then Reorder Name, then Reorder Version; reverse Tab returned to Reorder Name. Escape restored Columns. Return → Down → Return hid Kind while retaining trigger focus; Return restored Kind and Escape closed the menu. Native Space was not exercised because the automation rejected the attempted key names; the regression covers that key. Overview was restored afterward |
| Rendered dropdown behavior | Actual Dropdown, KeyboardProvider and production CSS in standalone Playwright, with only ZoomContext mocked: Tab visited Alpha Up/Down, Beta Up/Down, Gamma Up; reverse Tab returned to Beta Down. Searching Beta, ArrowDown and Enter selected Beta while focus remained in search. The rendered option had tabIndex -1 |
| Tablist accessibility risk | Confirmed, not merely hypothetical. axe-core 4.13.0 on the actual rendered Tabs component fails `aria-required-children` because tab actions are button children of the tablist. `aria-required-parent` and `nested-interactive` pass. The [axe rule](https://github.com/dequelabs/axe-core/blob/v4.13.0/lib/checks/aria/aria-required-children-evaluate.js) and [W3C ACT rule](https://www.w3.org/WAI/standards-guidelines/act/rules/bc4a75/proposed/) support the finding. The larger shared layout/focus-order repair is awaiting the user's scope decision; it is not waived by macOS AX exposure |
| Sonar and CI | The live audit at 6848f5aa returned one new issue: `typescript:S6819`, key `AaCOG92h-z6kAq375rY3`, on StatusIndicator's explicit status span. Changed it to native `<output className="sr-only">`, retaining the announcement outside the named trigger and updating its structural test. GitHub now reports every listed CodeQL and Sonar check successful, but the live Sonar issue contradicts the review's zero-issue statement. Remote closure requires analysis of a later pushed revision |
| Focused validation | Dropdown and StatusIndicator: 2 files / 55 tests passed after the changes, including the new failing-first Tab-order cases. Existing tests cover hover dismissal and keyboard entry/recovery |
| Coverage | Passed: 519 files / 4,949 tests, 87.14% overall statements. Dropdown 94.62%, StatusIndicator 90.90%. The coverage report was moved outside the frontend tree before the gate. The subsequent read-only props annotation changes TypeScript typing only |
| Final prerelease | Passed on the final source: `GOCACHE=/tmp/luxury-yacht-go-build STATICCHECK_CACHE=/tmp/luxury-yacht-staticcheck mise exec -- wails3 task qc:prerelease` exited 0, including Go vet/staticcheck/race, binding validation, frontend lint/typecheck, 519 files / 4,949 tests, Knip and Trivy. Biome applied no fixes. Post-gate status and source diff inspection found the seven intended modified files, and `git diff --check` passed |
| Other validation limits | Windows/Linux native Control+Tab and spoken VoiceOver/NVDA output remain untested. Prior macOS and browser checks are historical evidence above; the reviewer's own prerelease invocation cannot be reconstructed from its prose |

Re-review evidence is retained under `/tmp/luxury-yacht-rereview-`: `red.log`,
`green.log`, `coverage.log`, `coverage-report`, `complexity.log`, `counts.json`,
`axe.json`, `sonar.log`, `pr.json`, and `prerelease.log`. The temporary rendered
fixture was removed from the frontend, and no project dependency was added.

## Approved removal of per-tab Actions buttons

The user approved removing the three-dot buttons and their added spacing,
restoring the previous tab appearance. This change removes the shared button,
its consumer callbacks and its 2.4rem padding modifier. It retains the existing
Close control and 1.2rem close padding, right-click menus, and region navigation.
No replacement shortcut, visible control, dependency or larger tablist repair is
part of this approval.

| Criterion | Status | Evidence |
| --- | --- | --- |
| No extra tab button; Tab reaches Close directly | passed | Two new failing-first shared Tabs cases reproduced the extra button and intermediate Tab stop before removal. The focused Tabs, ClusterTabs, DockablePanel, DockableTabBar and ShortcutHelpModal run passed 5 files / 99 tests afterward, including right-click menu reordering and object-panel focus order. These tests mock backend and native boundaries |
| Rendered spacing and native focus | passed | Standalone Playwright rendered actual Tabs with production CSS and local descriptors: Close padding is 19.2px (1.2rem), tab height 32px, long-label maximum 240px, and no menu button. Tab reached the arrow-focused inactive tab's Close; reverse Tab returned to that tab without selecting it. Native macOS checks of the existing cluster tab and open gp2 object tab both went directly from tab to Close; screenshots showed the removed buttons and spacing |
| Coverage | passed | `mise exec -- wails3 task test:frontend-coverage` exited 0: 519 files / 4,949 tests, 87.14% overall statements. Tabs 89.05%, ClusterTabs 90.79%, DockableTabBar 92.30%, KeyboardNavigationGuide 100%. Generated coverage and the browser screenshot were moved to `/tmp/luxury-yacht-tab-rollback-` paths; the temporary fixture was removed |
| Changed-function complexity and typecheck | passed | Typecheck exited 0. Biome at max 12 found no changed/new function above the limit. Its four-file scan exits 1 for the existing `DockableTabBar.getDragImage` score of 13; the diff in that file removes only `onOpenMenu`, leaving that callback unchanged. No suppression or threshold changed |
| Current remote analysis | passed at 6831d5e3 | The existing PR audit returned zero open/confirmed new-code issues. GitHub reports Sonar and CodeQL success at 6831d5e3. This does not cover the uncommitted removal |
| Final prerelease and post-gate inspection | passed | `GOCACHE=/tmp/luxury-yacht-go-build STATICCHECK_CACHE=/tmp/luxury-yacht-staticcheck mise exec -- wails3 task qc:prerelease` exited 0, including Go vet/staticcheck/race, bindings, frontend lint/typecheck, 519 files / 4,949 tests, Knip and Trivy. The formatter only rewrapped the changed help paragraph. Post-gate source diff/status inspection found the 14 intended modified files and no temporary fixture or screenshot; `git diff --check` passed |

The native app and Vite listener on port 9245 were already running when this
removal's verification began. No development server or native app process was
started for this verification. The browser fixture and routes were cleared.

Windows/Linux Control+Tab delivery, spoken screen-reader output and the broader
tablist-structure issue remain outside this removal's verification.
