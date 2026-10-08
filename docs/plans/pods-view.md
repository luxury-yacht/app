# One pods table: Pods view and Pods tab

Status: implemented 2026-10-08; native check pending.

Today pods are rendered by two separate implementations:

- the Workloads view's lower pane (`frontend/src/modules/namespace/components/NsViewPods.tsx`);
- the object panel's Pods tab (`frontend/src/modules/object-panel/components/ObjectPanel/Pods/PodsTab.tsx`).

Their columns are defined twice (`NsViewPods.tsx:187`, `PodsTab.tsx:134`) and
already differ:

- Ready and Restarts are centred in one and right-aligned in the other.
- The Owner label is formatted differently.

The split pane around the lower pane is a one-off. It is the only consumer of
several shared table options (see Removals).

A nested-rows design was prototyped and dropped. It needed a new GridTable row
model, one query per expanded row, a per-cluster sort store and navigation
rewiring, and it still needed a separate Pods view for namespace-wide pod
lists.

## Target

- **One pods table component, shown in two places:**
  - a **Pods view**: a plain namespace view, one table like Config or Network;
  - the **object panel's Pods tab** for workloads and nodes, scoped exactly as
    today (`objectPanelPodsScope.ts:27-56`).
- **Workloads is a single table.** The split, the Pods pane and row selection go
  away.
- **"Show Pods" toggle in Workloads and Nodes.** An icon-bar toggle. While it is
  on, opening a workload or node from its table opens the object panel on its
  Pods tab instead of Details.
- **Pod "Go to Table View"** and Cluster Overview's pod count land in the Pods
  view.

This mostly restores the pre-#263 Pods view (commit `50a320c6` removed it),
plus a shared component and the toggle.

## Decided

- **"Show Pods" is an icon-bar toggle**, not a menu item or a filtered jump into
  the Pods view.
- **The toggle's state is an app preference per view** (Workloads, Nodes), kept
  across restarts, through the preferences path
  (`docs/architecture/app-preferences.md`). It is not part of table state or
  favorites.
- **Turning the toggle on affects only the next object opened.** An open panel
  stays on its current tab.
- **The toggle's icon is `CategoryIcon`**
  (`frontend/src/shared/components/icons/SharedIcons.tsx:445`), the icon the
  sidebar uses for every view (`frontend/src/ui/layout/Sidebar.tsx:237, 470, 542`).
- **CronJobs get a Pods tab.** The backend's `workload:` scope already matches a
  CronJob's pods through its Jobs (`backend/refresh/snapshot/pods.go:376-394`).
  CronJobs keep their Jobs tab too.
- **Favorites are flat again (decided 2026-10-08).** The multi-pane favorite
  (schema v3, a `panes` map) existed only for the split. Schema v4 stores one
  `filters` and one `tableState` per favorite, as v2 did, and the multi-pane code
  goes away.
- **Old Workloads favorites.** Every saved Workloads favorite has panes
  `{workloads, pods}`. Favorites saved on the old Pods view were migrated into a
  Workloads favorite whose `pods` pane holds their state and whose `workloads`
  pane is default (`backend/favorites_service_persistence.go:150-163`). The v4
  migration:
  - default `workloads` pane and customised `pods` pane → a Pods view favorite
    with the `pods` pane's state;
  - otherwise → a Workloads favorite with the `workloads` pane's state; the
    `pods` pane is dropped, even when both panes were customised;
  - any other favorite keeps its single `main` pane's state.

## Design

### Shared pods table

- **Where it lives.** Move the shared parts into `frontend/src/modules/resource-grid`.
  Both consumers already import from there, and the move follows the "promote
  once two real consumers need it" rule (`docs/frontend/component-structure.md:15-20`).
  The shared parts are:
  - the column builder;
  - pod row identity and actions (`useObjectActionController` with
    `portForwardAvailable`);
  - permission queries for the namespaces of visible rows
    (`frontend/src/shared/utils/podTableModel.ts:24-44`);
  - metrics staleness from `queryPayload.metrics`.
- **Two thin wrappers:**
  - the Pods view: a namespace query table, view id `namespace-pods`, favorites
    on;
  - the Pods tab: a cluster query table with a `workload:` or `node:`
    `baseScope`, view id `object-panel-pods`, favorites off (`PodsTab.tsx:241-263`).
- **Reconcile the differences** to one form:
  - Ready and Restarts centred, as on Workloads (`useWorkloadTableColumns.tsx:101-115`).
  - Owner shows the owner's name, with the owner's kind on hover (`NsViewPods.tsx:227-250`).
  - The Namespace column shows for all-namespaces scope and in the Pods tab.
  - Namespace links open that namespace's Pods view. Today they open Workloads
    (`NsViewPods.tsx:102`, `PodsTab.tsx:115`).
- **Drop the split-only behaviour:**
  - the collapse control and collapsed bar (`NsViewPods.tsx:334-353, 490-499`);
  - the owner filter rewriting (`NsViewPods.tsx:386-443`);
  - expand-on-focus (`NsViewPods.tsx:109-124`).

### Pods view

- **Register the view:**
  - add a `pods` namespace view descriptor after Workloads in the primary group
    (`frontend/src/core/navigation/viewRegistry.ts:196-216`);
  - render it from `frontend/src/modules/namespace/components/namespaceResourceViews.ts`;
  - stop parsing `'pods'` as Workloads (`frontend/src/types/navigation/views.ts:51-53`).
- **Streaming gate.** Namespace pod scopes stream while the Pods view is
  active, as before #263. Change `pods: 'workloads'` to `pods: 'pods'`
  (`frontend/src/core/refresh/resourceStreamViews.ts:21-23`). Focused
  `workload:`/`node:` scopes for the Pods tab are unchanged (`:11-17, 52-56`).
- **Permission features:**
  - Pods gets `namespacePods`.
  - Workloads keeps `namespaceWorkloads` (`frontend/src/core/refresh/components/diagnostics/diagnosticsPanelConfig.ts:74`).
- **Namespace filter.** The Pods view shares the All Namespaces filter like
  every other view, so the `sharesAllNamespacesFilter: false` opt-out goes away.
- **Table state.** The `namespace-pods` view id and its saved table state stay
  (`frontend/src/shared/components/tables/persistence/gridTableViewRegistry.ts:27`).
  Check what the pane's saved namespace selection does now that the view
  shares the namespace filter.

### "Show Pods" toggle

- **Placement.** An `IconBarToggle` (`frontend/src/shared/components/IconBar/IconBar.tsx:32-35`)
  in each table's `viewActions`, which sit after Include metadata and before
  Favorite (`docs/frontend/gridtable-filtering.md:11-13`).
  - Workloads already supplies `viewActions` (`NsViewWorkloads.tsx:129`). The
    Clear selected workload action it holds goes away with selection.
  - Nodes gains `viewActions`.
- **Effect.** While the toggle is on, the table's open handler calls
  `openWithObject(ref, { initialTab: 'pods' })` for kinds with a Pods tab.
  - Open handlers: `handleWorkloadClick` (`NsViewWorkloads.tsx:83-93`) and
    `handleNodeClick` (`frontend/src/modules/cluster/components/ClusterViewNodes.tsx:88-91`).
  - These cover Kind/Name links and Enter on a row.
  - A panel that is already open for that object switches to its Pods tab
    (`frontend/src/modules/object-panel/hooks/useObjectPanel.ts:147-153, 191-203`).
  - Rows without a Pods tab open as usual: standalone Pods.
- **Unchanged.** The context-menu "Open Details" item still opens Details.
  Alt-click still navigates to the table view.
- **State.** One app preference per view, kept across restarts. Turning it on
  does not change an already-open panel; the next object opened uses it.
- **CronJob Pods tab.** Add `cronjob` to the Pods tab's `onlyForKinds`
  (`frontend/src/modules/object-panel/components/ObjectPanel/constants.ts:102-106`)
  and to `WORKLOAD_SCOPE_KINDS` (`objectPanelPodsScope.ts:12-18`).
  - The pods come from the `workload:` scope with group `batch`.
  - The Jobs tab stays.

### Navigation

- **Pod navigation.** The Pod destination goes back to `{ viewType: 'namespace',
  tab: 'pods' }` (`frontend/src/utils/kindViewMap.ts:22`). The default
  destination id is `namespace-pods` (`frontend/src/shared/hooks/useNavigateToView.ts:82-83`),
  so the existing focus anchor on the pods table applies.
- **Cluster Overview.** The unfiltered pod count opens all-namespaces Pods
  instead of Workloads (`frontend/src/modules/cluster/components/useClusterOverviewNavigation.ts:64`).
  Status-filtered counts still go to Attention.

### Removals

- **Files:**
  - `WorkloadsPodsSplit.tsx`/`.css`/`.test.tsx`;
  - `podOwnerFilter.ts` and its test. Its only consumers are `NsViewPods.tsx:9-13`
    and the type import at `NsViewWorkloads.tsx:15`.
  - the split wiring in `NsViewWorkloads.tsx:261-350`.
- **Favorites:**
  - `FavoritePaneGroup` (`frontend/src/ui/favorites/FavToggle.tsx:108-153`);
  - the `favoritePane` option (`resourceGridTableTypes.ts:102, 197`). Workloads
    uses the default `main` pane.
- **GridTable selection API.** Its only production consumer is Workloads
  (`NsViewWorkloads.tsx:207-211, 236-240`):
  - `isRowSelected`, `onRowSelectionToggle`, `onRowSelectionClear`, and their
    plumbing (`GridTable.types.ts:213-221`; `useGridTableController.tsx:188-193,
    394-395, 546-563`);
  - Space then opens the focused row, as on other tables
    (`useGridTableShortcuts.ts:148-153`);
  - `onRowPointerClick` stays (`NamespaceSummaryTable.tsx:352`, `ParsedLogTable.tsx:36`).
- **Filter options:**
  - `beforeNamespaceActions` (`GridTable.types.ts:142, 281`;
    `GridTableFiltersBar.tsx:487-494`);
  - `sharesAllNamespacesFilter` (`useQueryBackedResourceGridTable.ts:547, 567, 588-589`).
- **CSS:** dead rules in `NsViewWorkloads.css:18-33`. Re-check
  `.workloads-pods-table-surface` (`:4-16`) against dock offsets.
- **Tests that read deleted files:**
  - `frontend/src/test-utils/cssCascadeContracts.test.ts:197-221`;
  - `resourceMetricsContract.test.ts:38`;
  - `queryBackedViewLoadingContract.test.ts:17`;
  - `queryBackedLeafFirstLoad.test.tsx` (pods cases).

### Favorites migration (backend)

- Add schema v4 to `FavoritesService.loadFavoritesFile`
  (`backend/favorites_service_persistence.go:66, 331-378`) using the Decided
  rules. v1 and v2 files migrate straight to the flat v4 shape; a v2 Pods
  favorite stays a Pods favorite.
- Favorites exports move to export schema 2 (flat). Import accepts export
  schema 1 (panes, converted by the same rules) and 2
  (`backend/data_management_import_export.go:262-300`).
- Frontend: `Favorite` carries `filters` and `tableState`; `FavoritePaneGroup`,
  pane ids and labels, and pane-keyed drafts in the save modal go away.

## Phases

Use red/green TDD for each behaviour change. Finish each phase with focused
tests, coverage of changed code, and the complexity check.

1. **Shared pods table.**
   - Extract it, switch the Pods tab to it, and reconcile the column
     differences.
   - Keep the meaningful tests from `PodsTab.test.tsx` and `NsViewPods.test.tsx`.
     Delete duplicates.
2. **Pods view.**
   - Descriptor, view render, stream gate, permission features.
   - Restore Pod navigation and Cluster Overview's pod count.
3. **Workloads.**
   - Remove the split and the Removals list.
   - Update the contract tests and docs.
4. **Favorites v4 migration** on load and import, with Go tests.
5. **"Show Pods" toggle** for Workloads and Nodes (`CategoryIcon`), its app
   preference, and the CronJob Pods tab.
6. **Docs, release notes, gate, native check.**
   - `mise exec -- wails3 task qc:prerelease`.
   - Native check in `mise exec -- wails3 dev` with the Playwright MCP.

## Progress

- **Phase 1 (shared pods table): done 2026-10-08.**
  - `frontend/src/modules/resource-grid/usePodTable.tsx` owns pod identity, columns, the CPU/Memory
    metrics ref, pod context-menu actions and the visible-pod permission queries. `NsViewPods.tsx`
    and `PodsTab.tsx` keep their own query, gating and `ResourceInventoryTable` render.
  - Reconciled in the Pods tab: Ready/Restarts centred, Owner shows the name with "name (Kind)" on
    hover, CPU/Memory sortable. The Workloads pane now also queries pod permissions in single-namespace
    mode (the permission store dedupes repeats).
  - Namespace links still open Workloads in both tables; phase 2 points them at the Pods view.
  - Evidence: new CPU/Memory sorting test failed before the change and passes after; shared contracts
    moved to `usePodTable.test.tsx` (20 tests) with duplicates removed from both consumer suites;
    affected suites 185/185; changed-file statement coverage 90–97%; complexity check clean (checker
    pinned by `scripts/biome-complexity.test.mjs`); `qc:prerelease` passed (5,345 frontend tests).
  - Pending: native check of the Pods tab (phase 6).
- **Phase 2 (Pods view): done 2026-10-08.**
  - `pods` namespace descriptor after Workloads (`refresher: null`); rendered by `NsViewPods`;
    `'pods'` no longer parses as Workloads. Stream gate, manual refresh and background refresh follow
    the Pods view; Workloads' background tick fetches only `namespace-workloads`. Diagnostics: Pods
    `namespacePods`, Workloads `namespaceWorkloads`.
  - Pod navigation → `{namespace, pods}` (default focus id `namespace-pods`; the unused
    `destinationViewId` override was removed). Cluster Overview's pod count and both tables'
    namespace links open the Pods view.
  - Evidence: 9 updated routing/refresh tests failed first, then passed; affected suites 2,625/2,625.
- **Phase 3 (Workloads single table): done 2026-10-08.**
  - Removed the split files, `podOwnerFilter`, selection, Clear selected workload, `FavoritePaneGroup`,
    `favoritePane`, `beforeNamespaceActions`, `sharesAllNamespacesFilter`, the GridTable selection API
    (`isRowSelected`, `onRowSelectionToggle`, `onRowSelectionClear`, `data-row-selected`, the hover
    overlay's selected state) and the dead `metrics` props. Space opens the focused row on every table.
  - Evidence: "single table without a Pods pane" and "shares the All Namespaces selection" failed
    first, then passed; no references remain (`grep` of `frontend/src`, `frontend/styles`, `backend`).
- **Phase 4 (flat favorites, schema v4): done 2026-10-08.** User decision: flatten instead of a
  one-entry `panes` map.
  - Go: `Favorite` has `filters`/`tableState`; v1/v2 migrate straight to v4 (a v2 Pods favorite stays
    Pods); v3 flattens per the Decided rule; export schema 2, import accepts 1 and 2.
  - Frontend: flat `Favorite`; one shared `favoriteTableSnapshotsEqual` replaces the two duplicated
    comparisons; the save modal edits one table snapshot.
  - Evidence: Go tests (v3 flatten, v2 views kept, export schema 1 import) red at compile, then green.
- **Phase 5 ("Show Pods" toggle, CronJob Pods tab): done 2026-10-08.**
  - `workloadsShowPods` / `nodesShowPods` app preferences; `useShowPodsToggle` supplies the
    `CategoryIcon` toggle and the Pods-tab open option; Workloads and Nodes open handlers use it.
  - CronJob added to the Pods tab kinds; the pods scope derives its kinds from `TABS.PODS`.
  - Evidence: backend preference test, hook test, CronJob tabs/scope tests and both views' Show Pods
    tests failed first, then passed.
- **Phase 6: docs, release notes and gate done; native check pending.**
  - `qc:prerelease` exit 0 on the final tree (5,328 frontend tests, Go race suite, lint, typecheck,
    bindings, knip, trivy); the worktree held only this change afterwards.
  - Complexity: every changed function ≤ 12. Pre-existing over-limit functions not touched by this
    change: `GridTableBody.tsx` `virtualWidth` (13) and `renderRows` (17),
    `useQueryBackedResourceGridTable.ts:350` effect (14).
  - Coverage of changed files 80–100% except `NsViewWorkloads.tsx` 78% (uncovered: existing
    alt-click navigation, Map action, local filter accessors, standalone-Pod row tint) and
    `eventBus.ts` (type-only change).
  - Native check not run: no Playwright MCP in the session, and `~/.kube` holds production
    kubeconfigs.

## Acceptance criteria

| # | Criterion | Status |
| --- | --- | --- |
| 1 | The Pods view lists the namespace's pods (and all namespaces' pods in all-namespaces mode) with backend search, sort, filters, paging and live updates; it streams only while active. | automated (stream gate, refresh, query tests); native pending |
| 2 | The Pods tab shows a workload's or node's pods from the same component, scoped as today, with favorites off. | automated (`PodsTab.test.tsx`); native pending |
| 3 | Pod columns, actions, permissions and metrics behave the same in the Pods view and the Pods tab; node pods across namespaces get per-namespace permissions. | automated (`usePodTable.test.tsx`) |
| 4 | Workloads is a single table: no split, no Pods pane, and Space opens the focused workload. | automated (single-table and Enter/Space tests) |
| 5 | With "Show Pods" on, opening a workload or node from its table (link or Enter) opens its panel on the Pods tab, and an already-open panel for it switches to Pods. With it off, Details opens. Rows without a Pods tab open as usual. | automated for open handlers; already-open panel switching relies on `useObjectPanel.ts:147-153` (not re-tested); native pending |
| 6 | The toggle is remembered per view across restarts; turning it on leaves an open panel's tab alone. | automated (backend persistence and hook tests); open panel untouched by design (read at open) |
| 6a | A CronJob's panel has a Pods tab listing the pods of all its Jobs, live, alongside its Jobs tab. | automated (tabs, scope, backend owner tests); native pending |
| 7 | Pod "Go to Table View" from the object panel, object map and other tables lands on and focuses that pod in the Pods view. | automated (`kindViewMap.test.ts`, default focus id); native pending |
| 8 | Cluster Overview's unfiltered pod count opens all-namespaces Pods. | automated (`ClusterOverview.test.tsx`) |
| 9 | Old Workloads favorites migrate as decided, on load and on import, and restore without a `pods` pane; old Pods-view favorites become Pods view favorites. | automated (Go migration and import tests) |
| 10 | The removed split-only options and selection API have no remaining consumers; contract tests pass. | done (grep shows no references) |
| 11 | `qc:prerelease` passes on the final tree; native check of the Pods view, the Pods tab, and the toggle in both views. | `qc:prerelease` passed; native check pending |

## Docs and release notes

- **Architecture docs:** `docs/architecture/large-data-producers.md:34-57`.
  Replace the two-table Workloads composition with a single Workloads table and
  a Pods view section.
- **Frontend docs:**
  - `docs/frontend/gridtable-filtering.md:11-13` (view-action example: Show
    Pods instead of Clear selected workload);
  - `gridtable-filtering.md:20-22, 69-72, 105-108, 129-136` (Pods pane
    exceptions and favorite panes);
  - `gridtable-interaction.md:21-29` (selection contract);
  - `navigation.md:46-52, 97` (pane group, pod count).
- **Workflow docs:** `docs/workflows/object-map.md:77-80`, if its Pod
  "Go to Table View" wording names Workloads.
- **Release notes:** `docs/release/pending.md` needs a Changed entry. Pods is
  its own view again, Workloads is a single table, and the "Show Pods" toggle is
  new.
