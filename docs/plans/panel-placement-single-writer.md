# Panel placement: single-writer prototype (finding #4)

Status: on `single-panel-writer`, Phase 0 (whole-group **Float** and
**dock-back**, `e1d3b937`), Phase 1 (**single-tab transfer**, `64595908`),
Phase 2 (**cluster-view transfer**, `d25ad0c7`), and Phase 3 (**close as an
intent**, `cbc1295a`) are committed. Phases 0 and 1 passed John's native checks
on macOS; Phase 2 and 3 checks are in progress. Phase 4 (**native index
without snapshots**) and Phase 5 (**close and quit**) are in the working tree,
uncommitted, and await their native checks
([Phase 4](#phase-4-native-index-without-snapshots),
[Phase 5](#phase-5-close-and-quit)). All five planned phases are implemented.

## Recommendation

**Go, with a narrower target than "every placement change is a directory
command."** Make the directory the only writer of *which renderer and group*
hold a panel. Keep each renderer as the writer of order, active tab, and edge
*within* the groups the directory gives it, published as window-scoped
arrangement reports. The prototype shows two things:

- The cross-window part of the two-writer design is where the race guards live.
  Moving it into the directory removed 7 of the 19 guards on this path and
  simplified 3 more. The transfer contract is now provable with Go tests on the
  real directory and registry.
- Making the directory also own in-window order and activation would need a
  `DockablePanelProvider` rewrite, and every reorder would wait on a directory
  round trip. The guards this prototype still needed for publication (G9, G13,
  G15) go once publications can no longer delete or claim panels (Phases 1–3,
  estimate, not prototyped). Full ownership would additionally remove only the
  arrangement report itself.

The gate before Phase 1 was John's native checks on this prototype (below).
They passed on macOS on 2026-10-20; Windows was not run. If dock-back's extra directory read
shows visibly, or any check finds a stuck or duplicated panel, stop and
re-evaluate.

## What the prototype changed

Backend:

- The directory owns a pending group move. `BeginGroupTransfer`,
  `CommitGroupTransfer` and `CancelGroupTransfer`
  (`internal/panelwindow/workspace_group_transfer.go:28,76,104`) record a
  `WorkspacePanel.Transfer` marker. The panel's placement stays unchanged until
  commit.
- Moving panels are immune to other writers:
  - a publication from the transfer's source or target skips them;
  - a publication from any other renderer is still rejected;
  - `Open` cannot reclaim a retained moving panel.

  See `internal/panelwindow/workspace.go:164,393,405`. A deleted panel leaves
  its transfer (`workspace_group_transfer.go:122`).
- The native transfer's single terminal releases the directory move
  (`internal/appwindow/panel.go:105,116`). Every failed or abandoned float or
  dock therefore cancels it.
- Registry:
  - Float and dock-back begin the move through `beginGroupPlacement`
    (`internal/appwindow/workspace.go:24`).
  - Ready-ack shows the window, then commits (`registry.go:511,535`).
  - Dock-back emits `panel-workspace:changed` instead of queueing
    `dock-requested` (`registry.go:558`).
  - The dock commit closes the native source first, then commits
    (`registry.go:608`).

Frontend:

- `WorkspacePanelSync` projects incoming dock-backs from directory reads
  (`incomingGroupTransfers`, `isForeignLocalPanel`, `applyIncomingTransfers`,
  `WorkspacePanelSync.tsx:64,94,297`). Retained restoration skips moving panels
  (`:504`).
- `useIncomingDockBack` (`WorkspacePanelCoordinator.tsx:581`) runs each incoming
  move:
  - freeze the view, or reject the move if the view is frozen;
  - mount the provisional copy;
  - flush, then acknowledge;
  - release the freeze when the directory stops listing the move.
- Float (`WorkspacePanelCoordinator.tsx:159`) and native dock-back
  (`PanelWindowApp.tsx:168`) no longer flush a publication before the intent.
- The `panel-window:dock-requested` event is gone: Go type and registration, TS
  helper, and generated bindings.

## Placement writers

On main (59136764) the following write placement.

Directory mutations (`internal/panelwindow/workspace.go`):

- `Open` (:139)
- `RetainWindow*` (:178)
- `Move` (:199)
- `RemoveWindow` (:216)
- `TransferGroup` (:254)
- `RestoreTransferredPanels` (:278)
- `PublishWindow*` (:324, :331)
- `RemoveCluster` (:453)
- `TransferClusterView` (`workspace_cluster_transfer.go:7`)

A second copy of each native group's tabs lives in `panelIndex.snapshots`
(`internal/appwindow/panel.go:74,118,156`). It also stores the pending transfer
ID (:212). Phase 4 removes it.

Renderers write through three channels:

- App views publish docked groups (`WorkspacePanelSync.tsx:199`).
- Native windows publish their group (`PanelWindowShortcuts.tsx:393`).
- Both rewrite local placement on events: opened (`Coordinator:536`) and
  dock-requested (`:549`).

After the prototype, `TransferGroup` and `RestoreTransferredPanels` are gone.
Float and dock-back placement changes only through
`Begin/Commit/CancelGroupTransfer`. Renderers still publish order and activation
for the panels they hold.

## Findings: guards on the Float and dock-back path

Line references are main at 59136764 unless marked "now" (working tree).

| # | Guard (doc rule) | Where on main | Under one writer | Evidence |
| --- | --- | --- | --- | --- |
| G1 | Intent must equal the published snapshot exactly, so the source flushes first (dockable-panels "check source guards and flush") | `appwindow/workspace.go:21`; `registry.go:240,275,569`; `WorkspacePanelCoordinator.tsx:156`; `PanelWindowApp.tsx:166` | **Removed.** The directory checks identity and source window; view state travels with the intent. | `TestFloatKeepsSourceUntilReadyAndSurvivesStaleSourcePublications` (yaml view, no publication) |
| G2 | Revalidate group source after the backend retention wait | `registry.go:273-279` | **Simplified.** Only cluster admission is rechecked; a moving group cannot change. | now `registry.go` `createRetainedPanelWindow` |
| G3 | Commit-time staleness ("panel group transfer source is stale") | `panelwindow/workspace.go:264` | **Removed.** Commit applies the recorded target. | `TestStaleSourcePublicationsCannotMoveDeleteOrDuplicateAFloatingGroup` |
| G4 | Rollback when show/close fails after commit, incl. retained fallback | `panelwindow/workspace.go:278`; `appwindow/workspace.go:123`; `registry.go:540,630` | **Removed.** The native side effect precedes commit; failure cancels. | `TestFailedFloatKeepsSourcePlacementWithoutPinningIt`, `TestFailedDockKeepsNativeSourceAndTellsTheTargetToDropItsCopy` |
| G5 | Provisional targets must not claim source panels | `appwindow/workspace.go:269-307` (dock half); `sync.stage`/`isProvisional` (`WorkspacePanelSync.tsx:129,217`; `Coordinator:571,605`) | **Moved** into one directory rule (`skipMovingPanelsLocked`). The cluster-view half and stage/settle remain for other paths. | `TestDockTargetPublicationCannotClaimItsProvisionalCopyBeforeCommit` |
| G6 | Directory reads started before staging or settlement must be invalidated | `WorkspacePanelSync.tsx:112-117,318-326` | **Removed for dock-back.** A copy exists only because a read listed it, and existing revision ordering suffices. Single-tab insert still uses it. | `WorkspacePanelSync.test` "ignores an older directory read that predates the move"; mutation M3 |
| G7 | Reject an incoming move while frozen by another transaction | `Coordinator:550-560` | **Still needed** (moved). | "rejects a dock-back while another transaction freezes this view" |
| G8 | Renderer-wide input freeze during transfers | `Coordinator:155,567`; `PanelWindowApp.tsx:165` | **Still needed.** It protects window-local drafts and terminals. | — |
| G9 | Transfer flushes retry the latest failed publication | `publicationQueue.ts:23`, used at `Coordinator:156,686`, `PanelWindowApp.tsx:166` | **Simplified.** It is off the intent path, but the dock-back target still flushes before acknowledging. | now `Coordinator:642`; see Risks |
| G10 | Queue `dock-requested` until the target is ready; a replay must not revive a failed move | `appwindow/workspace.go:73`; `registry.go:585` | **Removed.** The target reads the directory when ready. | `TestFailedGroupDockIsNotDeliveredWhenTargetBecomesReady` (ported) |
| G11 | Frontend 15 s dock timer and `acknowledging` flag | `Coordinator:405,635-663,681,714` | **Removed.** The backend timeout cancels, and the projection releases. | `TestFailedDock…/dock times out` |
| G12 | Target matches `transfer-failed` to its pending dock | `Coordinator:624-633` | **Removed.** | — |
| G13 | Docked publications replace the window's whole snapshot | `panelwindow/workspace.go:426` | **Still needed** (publication), plus one skip condition. | now `workspace.go:405` |
| G14 | A native snapshot cannot adopt another window's pending op | `panel.go:211` | **Still needed** until the index stops storing snapshots. Removed in [Phase 4](#phase-4-native-index-without-snapshots). | — |
| G15 | Stale publication after commit is rejected ("owned by another placement") | `panelwindow/workspace.go:378` | **Still needed.** | post-commit assertion in the G3 test |
| G16 | Float dedupe `pendingFloatGroupIdsRef` | `Coordinator:94-120` | **Still needed for UX.** The directory now also rejects overlap. | `TestGroupTransferRejectsStaleSourceAndOverlappingTransferAtomically` |
| G17 | Auto-float rollback re-docks a failed default-floating panel | `Coordinator:100,147,278,419` | **Still needed.** | — |
| G18 | `acknowledgedTransfers` ready-ack idempotence | `PanelWindowApp.tsx:55,101` | **Still needed.** | — |
| G19 | Cluster-removal reservations | `workspace_reservation.go` | **Still needed.** Begin validates the reservation. | `BeginGroupTransfer(…, reservations)` |
| N1 | *New:* an abandoned move must not pin panels | — | Release at `panelIndex.finishLocked` | failure tests; mutation M2 |
| N2 | *New:* a deleted panel leaves its move | — | `leaveTransferLocked` | `TestRemovedPanelsLeaveTheirPendingTransfer` |
| N3 | *New:* a retained moving panel cannot be reclaimed | — | `Open`, `retainedPanelOrder` | `TestOpenCannotReclaimARetainedPanelWhileItIsMoving` |
| N4 | *New:* drop a provisional copy whose source vanished | — | `isForeignLocalPanel` (replaces G11's timer for this case) | Sync test "native source closes"; mutation M4 |

## Measured payoff

- **Guards:** of the 19 existing guards (G1–G19), 7 were removed, 3 simplified
  or moved, and 9 are still needed; 4 invariants are new (N1–N4). Two of the
  four replace behavior the removed frontend timer provided.
- **Production lines, code only** (comments and blank lines excluded; measured
  by script over `git diff -U0` this session):

  | | Added | Removed | Net |
  | --- | ---: | ---: | ---: |
  | Backend | 205 | 135 | +70 |
  | Frontend | 227 | 236 | −9 |

  - Including comments, `git diff --numstat` plus the new file gives +515 /
    −393 (+489 / −367 ignoring whitespace).
  - The coordinator alone is +115 / −195. `WorkspacePanelSync` is +118 / −12.
  - Bindings: +12 / −9 (generated).
- **State:**
  - 7 removed:
    - `pendingDockRequest`;
    - `dockAttemptRef` (key, timer, acknowledging);
    - the frontend timer;
    - two rollback snapshots (`previous`);
    - the dock entries in `queuedWorkspaceEvents`;
    - the `dock-requested` message.
  - 6 added:
    - `WorkspaceDirectory.transfers`;
    - `WorkspacePanel.Transfer` (on the wire);
    - `panelGroupTransfer.release`;
    - `incomingByCluster`;
    - `incomingIds`;
    - dock-back `statuses`.
- **Tests:**
  - Go: 8 new directory tests and 5 new registry tests (2 with subtests). 2 old
    `TransferGroup` tests were deleted (now covered by the new ones) and 2 were
    ported.
  - Frontend: 4 dock tests replaced with 5, and 5 Sync projection cases added.
- **Mutation checks:** each mutation turns the named tests red; restored files
  were verified with `cmp`.

  | # | Mutation | Tests that fail |
  | --- | --- | --- |
  | M1 | publication may delete a moving panel | 2 |
  | M2 | no release on native failure | 3 |
  | M3 | provisional copy treated as foreign | 3 |
  | M4 | vanished source ignored | 1 |
  | M5 | acknowledgement not deduplicated | 1 |

- **Bug the tests caught:** the coordinator first passed
  `guards.releaseTransfer` unbound, which throws at runtime ("#transfers" of
  undefined). The `vi.fn` guard mock hid it. The release test now drives the
  real `PanelLifecycleGuardRegistry`.

On one path, the single writer roughly breaks even on lines. The reductions in
lines come with later phases, which reuse the directory transfer and projection
and delete the shared two-writer machinery that this path still needed.

## Risks

- **Native multi-window behavior is proven on macOS only.** Registry and Vitest
  suites replace Wails windows, events, and focus with fakes. Window show/close
  ordering changed: dock-back closes the source before commit, and float shows
  the window before commit. John's macOS checks passed; Windows was not run.
- **An orphaned move pins panels.** Publications ignore a moving panel. A
  terminal path that skips `finishLocked` would leave it unclosable. Today every
  `panelIndex` terminal goes through `finishLocked` (`panel.go:116`). Phase 4
  kept the two records; see [Phase 4](#phase-4-native-index-without-snapshots)
  for why.
- **Dock-back needs one extra round trip.** The target learns of the move from
  `panel-workspace:changed` followed by `GetPanelWorkspace`, instead of from an
  event payload. The cost is not measured here [unverified]; native check 4
  observes it.
- **A stale publication could be rejected after commit.** Resolved in
  [Phase 3](#phase-3-close-as-an-intent): publications now skip panels placed
  elsewhere instead of rejecting.
- **The target's pre-acknowledgement flush stays.** Without it, a stale target
  publication that omits the committed tabs would delete them until the next
  publication. That would fire panel-removal handlers such as the metrics
  buffer.
- **A failed directory begin can leave a new app window behind.** Dock-back
  resolves its target app window, possibly creating one, before the directory
  validates the group. A rare failed begin leaves that empty window.

## Phased plan for the remaining paths (if go)

Each phase reuses `Begin/Commit/CancelGroupTransfer` and the read-driven
projection. Each needs its own TDD, its Go contract tests, and native checks.

1. **Single-tab transfer.** Done in the working tree; see
   [Phase 1](#phase-1-single-tab-transfer). Two planned deletions moved:
   `sync.stage`/`settle`/`isProvisional`/`transferRevision` stay because
   cluster-view transfer still uses them, and the tab-insert event stays for
   live native targets.
2. **Cluster-view transfer.** Done in the working tree; see
   [Phase 2](#phase-2-cluster-view-transfer). The source still flushes before
   accepting, until Phase 3 makes close an intent.
3. **Close as an intent.** Done in the working tree; see
   [Phase 3](#phase-3-close-as-an-intent). The cluster-view source flush (C6)
   stays: it now drains queued close intents.
4. **Native index without snapshots.** Done in the working tree; see
   [Phase 4](#phase-4-native-index-without-snapshots). The directory move is
   now the only record of where panels go; the native lifecycle record stays
   for window state and timeouts, like the tab and cluster handoffs.
5. **Close and quit.** Done in the working tree; see
   [Phase 5](#phase-5-close-and-quit). A closing app view now asks the
   directory which moves target it and declines them. Close sequences hold no
   placement logic beyond directory calls. The protocol checks for requests
   not yet accepted stay, because the directory does not see those requests.

Open already writes the directory first (`OpenPanelWorkspaceObject`). The
prototype's immunity rules cover it, so it needs no phase.

## Phase 1: single-tab transfer

What changed (working tree on top of `e1d3b937`):

- The source's `AcceptPanelTabTransfer` begins a one-tab directory move
  (`beginPanelTabPlacementLocked`, `internal/appwindow/panel_tab_transfer.go`).
  Its release runs at the tab transfer's single terminal
  (`removePanelTabTransferLocked`). A tear-off's move is the new window's open
  transfer from Phase 0, so completion only finishes the tab transfer
  (`finishOpenedPanelTabTransfer`).
- The directory places a moving group at an insert index: the drop index for a
  dropped tab, `AppendToGroup` for dock-back. On commit, existing tabs at or
  after it make room (`insertIndexLocked`, `makeRoomLocked`,
  `workspace_group_transfer.go`).
- Every target settles through one endpoint, `AcknowledgePanelTransfer(caller,
  transferID, mounted)`, which routes by transfer ID. It replaces
  `AcknowledgePanelWindowDock` in every binding layer.
- App targets project tab moves exactly like dock-back (`IncomingGroupTransfer`
  gained `insertIndex`; the coordinator hook is now `useIncomingPanelTransfers`).
  Native targets keep the insert event and acknowledge once the tab is mounted
  (`PanelWindowShortcuts.tsx`).

Guards on the single-tab path (main line refs where they existed):

| # | Guard | Under one writer |
| --- | --- | --- |
| T1 | Exact source equality at request, so the source flushes first (`panelTabActions.ts:24`, `WorkspacePanelCoordinator.tsx:445`, `PanelWindowShortcuts.tsx:175`) | **Removed.** An identity check at request; the directory decides at accept. |
| T2 | Target publication commits the move (publication approvals, `validPublicationTransfer`, directory `Move`, `moveTransferredPanel`) | **Removed.** The target acknowledges explicitly; publications never move panels. |
| T3 | App target staging and read invalidation for tab insert (`Coordinator:483-526`) | **Removed for this path.** Cluster-view still uses them. |
| T4 | Workspace insert queue and its replay check (`workspaceEventPending`, `panelTabInsertionPending`) | **Removed.** |
| T5 | App target `pendingTargets` and copy cleanup on failure | **Removed.** The projection drops the copy. |
| T6 | Tear-off double commit | **Removed.** |
| T7 | App target rejects: frozen, unselected cluster, non-dock group, already owned | **Simplified.** Only "frozen" remains; the directory validates the rest. |
| T8 | Native target insert and failure cleanup | **Still needed**, plus a new mount-then-flush-then-acknowledge effect. |
| T9 | Source authority checks (`isAuthoritativeTransferSource`, `samePanelTab`) | **Still needed.** |
| T10 | One pending transfer per source tab; transfer timeout | **Still needed.** The timeout now also cancels the directory move. |
| N5 | *New:* the tab transfer's terminal releases its directory move | — |
| N6 | *New:* drop-index placement in the directory | — |

Measured (code only, comments and blank lines excluded, `git diff -U0` against
`e1d3b937`):

- **Production:** backend +175 / −170 (net +5); frontend +91 / −124 (net −33).
  Including comments: +332 / −316.
- **Tests:** +285 / −287.
- **Cumulative since main (59136764, Phases 0 and 1):** backend +373 / −298
  (net +75); frontend +293 / −335 (net −42); +808 / −670 including comments.
- **Guards:** 6 of 10 removed, 1 simplified, 3 still needed; 2 new.
- **Mutation checks:** each mutation was reverted, and each was caught.

  | # | Mutation | Tests that fail |
  | --- | --- | --- |
  | M7 | accept begins no directory move | 4 |
  | M8 | the tab terminal skips release | 2 |
  | M9 | native target acknowledges before its publication | 1 |
  | M10 | drop index ignored | 3 |

- **Evidence:**
  - `go test` passes for `panelwindow`, `appwindow`, `bootstrap`, and
    `backend`; `-race` passes on the transfer packages.
  - Vitest: 168 passed across `src/core/panel-windows`, `PanelWindowApp`, and
    `PanelWindowShortcuts`.
  - gocognit: maximum 12 on changed functions. Biome complexity is clean, and
    knip exits 0.
  - Coverage of the changed functions is 75–100% (Go).
    `WorkspacePanelCoordinator.tsx` is 96.2%, `WorkspacePanelSync.tsx` 96.5%,
    and `PanelWindowShortcuts.tsx` 86.8% statements.

Phase 1 native checks. Run these on macOS and Windows; Linux drag-out is
deferred. For each check, confirm that no tab is duplicated or lost and no error
toast appears.

1. **Drop into the app.** Drag a native tab onto the app's right dock strip
   between two tabs.
   - Path: `WorkspacePanelCoordinator` `handleExternalTabDrop`.
   - Expect it at that position.
   - The native window closes if that was its last tab.
2. **Drop into a native window.** Drag an app tab onto an existing native
   window's strip at position 2.
   - Path: `PanelWindowApp` `handleExternalTabDrop`.
   - Expect it at that position. It leaves the app dock.
3. **Native to native.** Drag a tab from one native window onto another.
4. **Tear-off.** Drag a native tab, or one tab of a multi-tab app dock, to the
   desktop.
   - Path: `handleTabTearOff`.
   - Expect a new window with that tab.
5. **Tab menu, native.** Right-click a native tab and choose **Dock to bottom**
   (`DockableTabMenu.tsx`).
   - Expect it appended to the app's bottom dock.
   - If the app shows another cluster tab, it switches first.
6. **Tab menu, app.** Right-click a docked object tab and choose **Float**.
   - Expect only that tab in a new window.
7. **View travels.** Switch a tab to YAML, then within a second drag it to
   another window. Expect it to arrive showing YAML (the removed flush, T1).
8. **Two app windows.** With the same cluster in two app windows, drag a docked
   tab from one to the other's dock. Expect a move, not a copy.
9. **After the moves.**
   - Close a moved tab in its new window: it closes.
   - Reopen the object from another window: it focuses the moved tab.
10. **Blocked moves.**
    - With unsaved YAML in a tab, its drag and menu moves are blocked
      (unchanged guard).
    - Quit after the moves, then restart: the selections restore.

## Phase 2: cluster-view transfer

What changed (working tree on top of `64595908`):

- At acceptance, the registry calls `BeginViewTransfer`, which moves every
  docked panel the directory places in the source view for that cluster. Each
  panel keeps its edge, order, and activation, appended after the target's tabs;
  the move is marked `View` (`workspace_group_transfer.go`). The insert event
  carries those groups, produced by the directory. The source sends only its
  view state (`ClusterViewSnapshot` lost `groups`).
- `CommitClusterViewTransfer(source, target, cluster, transferID)` commits the
  directory move inside the backend's selection mutation. The cluster transfer's
  terminal (`removeClusterTransferLocked`) releases an uncommitted move.
- On the target, the panel projection mounts view moves but never guards or
  settles them (`useIncomingPanelTransfers`). The cluster coordinator restores
  the view and acknowledges once the listed panels are mounted.
- `makeRoomLocked` now handles several arriving groups, which replaces
  `appendPlacementsLocked`.

Guards on the cluster-view path (main line refs):

| # | Guard | Under one writer |
| --- | --- | --- |
| C1 | Source-sent groups checked against the directory: exact tab equality, plus "omits a docked panel" (`workspace_cluster_transfer.go:29-45` on main) | **Removed.** The directory picks the set; a panel opened but not yet published travels too (it used to fail the move). |
| C2 | Target publications exclude provisional view tabs (`excludeProvisionalDockTabs`, `addClusterTransferTabs`, `appwindow/workspace.go:264-368` on main) | **Removed.** Moving panels are immune. |
| C3 | Target staging, read invalidation, and `isProvisional` checks, including the empty-view marker (`WorkspacePanelSync.tsx:111-150,217,273,318-326`, `ClusterTabTransferCoordinator.tsx:135-143`) | **Removed**, together with the last staging code in Sync. |
| C4 | Retained claims paused during a transfer (`WorkspacePanelSync.tsx:273`) | **Removed.** The commit (`820d554d`) gives no reason. The plausible risk, panels retained mid-transfer, is covered by N3 [assumed]. |
| C5 | Target mounts panels from the source-sent snapshot | **Replaced** by the read-driven projection. |
| C6 | Source flushes before accepting | **Still needed.** The reason changed: closes are publications, so the set is right only after they land (Phase 3). |
| C7 | Queued insert for a target that is not ready, discarded on cancel | **Still needed.** It carries the view state. |
| C8 | Target acknowledges only after exact panel reconstruction | **Still needed.** The groups now come from the directory. |
| C9 | Frozen-target rejection, source blockers, one transfer per cluster, timeouts, created-window cleanup | **Still needed.** |
| N7 | *New:* the cluster transfer's terminal releases its directory move | — |
| N8 | *New:* `View` marks moves the projection mounts but must not settle | — |

Measured (code only, against `64595908`; cumulative against main `59136764`):

- **Production, Phase 2:** backend +138 / −170 (net −32); frontend +54 / −78
  (net −24). Including comments: +239 / −272.
- **Tests, Phase 2:** +190 / −146.
- **Cumulative since main (Phases 0–2):** backend +488 / −445 (net +43);
  frontend +330 / −396 (net −66). Total net −23 code lines (+997 / −892
  including comments).
- **Guards:** 4 of 9 removed, 1 replaced, 4 still needed; 2 new.
- **Mutation checks:** each mutation was reverted, and each was caught.

  | # | Mutation | Tests that fail |
  | --- | --- | --- |
  | M11 | accept begins no view move | 4 |
  | M12 | the cluster terminal skips release | 1 |
  | M13 | the projection settles view moves | 1 |
  | M14 | the target acknowledges before its panels mount | 1 |

- **Evidence:**
  - `go test` passes for `panelwindow`, `appwindow`, and `bootstrap`, and for
    the `backend` cluster-view, desktop-service, and startup tests; `-race`
    passes on the transfer packages.
  - Vitest: 168 passed.
  - gocognit: maximum 12. Biome complexity is clean, and knip exits 0.
  - Coverage of the changed Go functions is 83–100%.

Phase 2 native checks. Run these on macOS and Windows. For each check, confirm
that no panel is duplicated or lost and no error toast appears.

1. **Drag to another app window.** With two app windows, drag a cluster tab
   that has docked panels on both edges onto the other window's cluster strip.
   - Path: `ClusterTabs.tsx` drop → `requestClusterTabTransfer`.
   - Expect the tab at the drop position with its navigation, both edges'
     panels in order with their active tabs, and the source tab gone.
   - The source window closes if that was its last tab.
2. **Move to new window.** Open the cluster tab's menu and choose **Move to new
   window** (`ClusterPanelsMenu.tsx`), then drag a cluster tab out of the
   window (`onClusterTabTearOff`).
   - Expect a new window with the same view and panels.
3. **Panel opened just before the move.** Open an object, then immediately
   drag its cluster tab to the other window.
   - Expect the new panel to travel with the view (C1).
4. **Panel closed just before the move.** Close a docked panel, then
   immediately move the cluster tab.
   - Expect it not to reappear in the target (C6).
5. **Cluster already open in the target.** Move a cluster tab into a window
   that already shows that cluster with its own docked panels.
   - Expect the arriving panels after the existing ones.
   - The arriving active tab becomes active.
6. **Empty view.** A cluster tab with no panels moves and keeps its navigation.
7. **Blocked move.** Give a docked panel unsaved YAML, then try to move its
   cluster tab.
   - Expect it to be blocked with focus on the editor.
   - The source keeps everything.
8. **Retained panels.** Close an app window that showed cluster A with docked
   panels, then move another window's A tab elsewhere.
   - Expect the retained panels to be restored once, with no duplicates (C4).
9. **After the moves.** Close a moved panel: it closes. Quit and restart: the
   selections restore.

## Phase 3: close as an intent

What changed (working tree on top of `d25ad0c7`):

- **Closing a panel is a directory intent.** `ObjectPanelStateContext` announces
  closes through `closePanel` and `onCloseObjectPanel`, never through
  `removeOwnedPanel`, which moves use. The new `useClosedPanelIntents` sends
  `ClosePanelWorkspaceObject` for each close through that renderer's outbound
  queue: `WorkspacePanelSync`'s in app windows, `PanelWindowShortcuts`' in
  native windows. The directory's `ClosePanel` removes a panel only if it still
  places it in the caller's window and is not moving it.
- **Publications only arrange.** `PublishWindow` updates edge, order,
  activation, and view of the caller's own panels. It never opens, closes,
  claims, or moves a panel, and never rejects one placed elsewhere.
- **A closing cluster leaves publications instead of pausing them.**
  `WorkspacePanelSync` drops a closing cluster from its publications; other
  clusters keep publishing.

Guards (main line refs):

| # | Guard | Under one writer |
| --- | --- | --- |
| P1 | `unpublished`: a panel opened before the renderer's publication survives it (`panelwindow/workspace.go:100,165,173,428`) | **Removed.** |
| P2 | Publication rejected when it names a panel placed elsewhere (G15, `:378`) | **Removed.** Such panels are skipped. This also removes Phase 0's spurious-error residual risk. |
| P3 | Publication rejected when it opens a second panel for an open object (`validateObjectIdentityLocked`) | **Removed.** Publications cannot open panels; malformed input is still rejected. |
| P4 | Publications skip moving panels (Phase 0) | **Simplified.** Part of the arrangement-only rule. |
| P5 | Whole-snapshot replacement deletes omitted panels (G13, `replacePublishedWindowLocked`) | **Removed.** |
| P6 | Pause all publication until an accepted cluster close reaches the selection, plus the dedupe reset on settle (`WorkspacePanelSync.tsx:184-208,169`) | **Simplified** to "a closing cluster drops out". |
| P7 | Cluster-view source flush (C6) | **Still needed.** It drains queued close intents. |
| P8 | Publication queue retries its latest failure on flush (G9) | **Still needed.** It now also covers close intents (see Risks). |
| N9 | *New:* close intent announced by the provider and queued per renderer | — |
| N10 | *New:* the directory ignores a close for a panel placed elsewhere or moving | — |

Measured (code only, against `d25ad0c7`; cumulative against main `59136764`;
the new `useClosedPanelIntents.ts` is included):

- **Production, Phase 3:** backend +57 / −57 (net 0); frontend +66 / −12 (net
  +54). Including comments: +156 / −83.
- **Tests, Phase 3:** +239 / −73. About 20 tests that created panels by
  publishing now seed them with `Open` (`seedPanels`, `seedNativeGroup`), as
  production does.
- **Cumulative since main (Phases 0–3):** backend +528 / −485 (net +43);
  frontend +396 / −408 (net −12). Total net +31 code lines.
- **Guards:** 4 of 8 removed, 2 simplified, 2 still needed; 2 new.
- **Mutation checks:** each mutation was reverted, and each was caught.

  | # | Mutation | Tests that fail |
  | --- | --- | --- |
  | M15 | close removes a moving panel | 1 |
  | M16 | a publication claims another window's panel | 2 |
  | M17 | a close intent bypasses the outbound queue | 1 |
  | M18 | a bulk close is not announced | 1 |

- **Evidence:**
  - `go test` passes for `panelwindow`, `appwindow`, `bootstrap`, and
    `backend` (the ownership contract now counts 26 panel commands); `-race`
    passes on the transfer packages.
  - Vitest: 1,210 passed across panel-windows, `PanelWindowApp`, shortcuts, and
    object-panel.
  - gocognit: maximum 12. Biome complexity is clean, and knip exits 0.

Phase 3 risks:

- **A close intent that fails leaves a ghost panel.** This happens only on an
  IPC failure. The directory keeps the panel until its window or cluster
  closes, because a later publication no longer repairs it. The outbound queue
  retries only its latest failure, so a later successful publication clears a
  failed close. A per-intent retry would fix this if it ever shows up.
- **A native index snapshot can name a foreign panel.** A native window's
  snapshot that names another window's panel is no longer rejected. The
  directory ignores it, but the native index stores the report until Phase 4
  removes that copy. Only a buggy renderer could trigger this. Resolved in
  [Phase 4](#phase-4-native-index-without-snapshots).

Phase 3 native checks. Run these on macOS and Windows. For each check, confirm
no duplicate or lost panel and no error toast.

1. **Close a docked tab.** Use its tab close button or its context menu's
   **Close** (`DockableTabMenu.tsx`). It disappears. Open the same object from
   another window: it opens a new panel and does not focus a ghost.
2. **Close every tab in a group.** Click the dock header's Close
   (`DockablePanelGroup.tsx` `handleClose`). Every tab closes.
3. **Close a non-final tab in a native window.** It disappears. Reopen the
   object elsewhere: it opens a new panel.
4. **Close the final tab in a native window.** The window closes.
5. **Close, then move.** Close a docked tab, then immediately drag its cluster
   tab to another window. The closed tab does not reappear (P7).
6. **Close a cluster shown in two windows.** Close the cluster tab in one
   window; the other window keeps every shared panel. Close the last view: its
   panels close.
7. **Arrangement survives.** Reorder tabs and move one to the other edge, then
   close the app window that holds them. Floating panels stay. Reopen the
   cluster in another window: the retained panels come back in the arranged
   order.

## Phase 4: native index without snapshots

What changed (working tree on top of `cbc1295a`):

- **The native index stores no group.** `panelIndex.snapshots`,
  `UpdateSnapshot`, `ValidateSnapshot`, `DockTarget`, `IsTransferParticipant`,
  and `clonePanelGroupSnapshot` are gone (`internal/appwindow/panel.go`). The
  index keeps each window's cluster and group, its state, and one native
  lifecycle record per pending open or dock: window, state, opening source,
  directory release, and timeout.
- **The descriptor reads the directory.** `WindowDescriptor` replaces
  `Snapshot` with `TransferID` and `Group`. `Registry.withPanelGroup` fills
  `Group` from the new `WorkspaceDirectory.WindowGroup`: the panels placed in
  the window, or while it opens, the panels its opening move takes in.
  `PanelWindowApp`, `main.ts`, `ObjectPanelStateProvider` (`initialGroup`), and
  the native close fallback read it.
- **Native reports only arrange.** `UpdatePanelWindowSnapshot` became
  `PublishPanelWindowGroup(window, WorkspaceGroup)`. It checks that the window
  is live and names its own cluster and group, then calls the arrangement-only
  `PublishWindow`. A report carries no transfer ID, so it cannot touch a
  pending transfer.
- **The directory move names the dock target.** The dock commit and the
  participant check read `WorkspaceDirectory.TransferTarget`, not a second copy
  on the native record.
- **Tab close checks the directory.** `RequestPanelTabClose` authorizes only a
  panel the directory places in the window.
- **The opened event reports directory tabs.** `WindowOpenedEvent` replaces
  `Snapshot` with `SourceWindowName` and `Tabs`, read after commit.

Guards (refs at `cbc1295a`):

| # | Guard | Under one writer |
| --- | --- | --- |
| F1 | G14: a published snapshot cannot adopt another window's pending transfer (`panel.go:240-248`) | **Removed.** Reports carry no transfer ID, and only `BeginOpen`/`BeginDock` create a window's transfer. The adoption test is deleted. |
| F2 | Each report re-validates the snapshot schema, transfer ID, and source window (`registry.go:704-709`) | **Simplified** to `ValidatePublication`: a live window, naming its own cluster and group. |
| F3 | Descriptors deep-copy the stored snapshot so readers cannot change it (`clonePanelGroupSnapshot`) | **Removed.** Each read builds a new group. |
| F4 | Dock target and position copied onto the native record (`DockTarget`) | **Removed.** Read from the directory move. |
| F5 | Tear-off completion re-checks source, cluster, group, and tab against the stored snapshot (`panel_tab_transfer.go:418-427`) | **Removed.** The open validated them and bound the window, and IDs are never reused (mutation M23 could not fail). |
| F6 | Window-closed event also sent to the stored snapshot's source (`registry.go:544-553`) | **Removed.** Only app views subscribe (`WorkspacePanelCoordinator.tsx:456`, mounted by `App.tsx`), and every app view already receives it. |
| F7 | Tab close authorized from the stored snapshot (`registry.go:725`) | **Still needed, now authoritative.** It reads the directory, which resolves the Phase 3 foreign-panel risk. |
| F8 | Native lifecycle record linked to the directory move by `release` | **Still needed** (see below). |
| F9 | Reports only from a live window | **Still needed.** |
| N11 | *New:* the directory projects a native window's group (`WindowGroup`) | — |
| N12 | *New:* the directory reports a move's target (`TransferTarget`) | — |

**Why two transfer records remain.** The plan asked for the directory move to
be the only transfer record. It is now the only record of *where* the panels
go (F4). The native record keeps what only the native side knows: whether the
window is opening or docking, the opening source, the timeout, and used IDs.
The tab and cluster handoffs split their records the same way
(`transfer_lifecycle.go`), so folding only this one into the directory would
make it the exception. The orphaned-move risk is unchanged: every native
terminal still releases through `finishLocked`.

Measured (code only, against `cbc1295a`; cumulative against main `59136764`,
same script):

- **Production, Phase 4:** backend +145 / −173 (net −28); frontend +36 / −39
  (net −3).
- **Tests, Phase 4:** +148 / −163 in existing files, plus the new
  `panel_descriptor_test.go` (117 code lines, 4 tests). Native fixtures now
  place their groups in the directory instead of reading them back from the
  index. One test assertion changed meaning: after a committed move out of a
  native window, the old test expected the stale stored copy to still list the
  moved tab; the directory now reports the window empty.
- **Cumulative since main (Phases 0–4):** backend +637 / −632 (net +5);
  frontend +432 / −447 (net −15). Total net −10 code lines. The same script
  gives net +33 backend at `cbc1295a`; the +43 in Phase 3 came from a slightly
  different file filter.
- **Guards:** 5 of 9 removed, 1 simplified, 3 still needed; 2 new.
- **Mutation checks:** each mutation was reverted (verified with `cmp`), and
  each was caught. M23 could not fail, so its check was removed (F5).

  | # | Mutation | Tests that fail |
  | --- | --- | --- |
  | M19 | an opening window's descriptor ignores the incoming move | 1 |
  | M20 | tab close authorizes a panel the window does not hold | 3 |
  | M21 | any window may cancel a dock-back | 1 |
  | M21b | any window may cancel an opening window | 1 |
  | M22 | a non-target app view may commit a dock-back | 1 |
  | M24 | a report is accepted from a window that is not live | 1 |
  | M25 | the native provider is not given the directory group | 1 |
  | M26 | the provider ignores the group's tabs | 1 |
  | M27 | a native report drops its group identity | 1 |
  | M28 | a view that is not the source handles the opened event | 1 |
  | M29 | native bootstrap reads no transfer ID | 1 |

- **Evidence:**
  - `go test` passes for `appwindow`, `panelwindow`, `bootstrap`, `backend`,
    and `cmd/project`; `-race` passes on `appwindow` and `panelwindow`.
  - Vitest: 197 passed across panel-windows, `PanelWindowApp`, `main`,
    shortcuts, and the object-panel provider.
  - gocognit: maximum 12. Biome complexity is clean.

Phase 4 risks:

- **A dock whose panels all vanish loses its target.** If cluster removal
  deletes every moving panel, the directory drops the move and its target. The
  dock acknowledgement then fails as stale, and cluster removal closes the
  native window anyway [assumed acceptable].
- **The descriptor is two reads.** It reads the index, then the directory, not
  under one lock. A commit between them is harmless: committed panels are
  placed in the window, so the group is the same.

Phase 4 native checks. Run these on macOS and Windows. For each check, confirm
no duplicate or lost panel and no error toast.

1. **Float shows the group.** Open two objects in the right dock and switch the
   second to YAML. Click **Float panel** (`DockablePanelControls.tsx` →
   `WorkspacePanelCoordinator` `handleGroupMove`). The native window shows both
   tabs in order, the second active, with YAML showing. The window now reads
   these tabs from the directory.
2. **Tear-off shows the tab.** Drag a docked tab onto the desktop
   (`DockablePanelProvider` → `handleTabTearOff`). The new window shows that
   tab, and the source loses it. Repeat from a native window with two tabs
   (`PanelWindowShortcuts` tear-off).
3. **Arrangement reaches dock-back.** In a native window, reorder the tabs and
   switch one tab's view. Then click **Dock to bottom** (`PanelWindowApp`
   `handleGroupMove`). The app's bottom dock shows the new order, active tab,
   and view.
4. **Close in a native window.** Close a non-final tab with its close button,
   then press Cmd/Ctrl+W (`PanelWindowShortcuts` `closeActiveTab` →
   `requestPanelTabClose`). Each action closes one tab. Closing the last tab
   closes the window.
5. **Close right after a move in.** Drag a tab from the app onto a native
   window's tab strip, then close it from the native window straight away. It
   closes and does not reappear.
6. **Two app views.** Open the cluster in two app windows, then dock a native
   window back. The group lands only in the most recently focused app window
   (`appWindowForCluster`).

## Phase 5: close and quit

What changed (working tree on top of Phase 4):

- **A closing app view declines the moves addressed to it.** `handleClosing`
  (`internal/appwindow/registry.go:874`) calls `declinePanelMovesInto`. That
  function asks the directory which pending moves target the closing window
  (`WorkspaceDirectory.MovesInto`), then declines each one through
  `AcknowledgePanelTransfer(window, id, false)`, the same call a target
  renderer makes when it cannot mount a move.
- Before this, nothing cancelled a dock-back into a closing app view. The
  native source stayed frozen until the 15 s dock timeout (Phase 0 native
  check 9 recorded that delay).

Close and quit inventory (current tree):

| # | Step in a close or quit sequence | Role | Phase 5 |
| --- | --- | --- | --- |
| Q1 | App-window close cancels the cluster-view transfers it sends or receives (`registry.go:862`) | Protocol sweep; also covers requests not yet accepted | **Still needed** |
| Q2 | App-window close cancels the tab transfers it sends or receives (`registry.go:873`) | Protocol sweep; also covers requests not yet accepted | **Still needed** |
| Q3 | Nothing cancelled a dock-back into a closing app view | Gap | **Fixed** with a directory query (`registry.go:874`) |
| Q4 | Native-window close cancels its tab transfers and its own open or dock (`registry.go:775-777`) | Protocol sweep and the window's own record | **Still needed** |
| Q5 | Cluster close refuses while a cluster-view transfer or a native open or dock is pending (`cluster_panel_close.go:47-56`) | Protocol checks; also cover requests not yet accepted | **Still needed** (see below) |
| Q6 | Renderer preflights refuse while a transfer freezes the renderer (`panelLifecycleGuards.tsx:139`) | G8: protects window-local drafts and terminals | **Still needed** |
| Q7 | Renderer preflights flush their outbound queue (`panelLifecycleGuards.tsx:153`) | Drains queued close intents and arrangement reports; decides no placement | **Still needed** |
| Q8 | Cluster close pauses the cluster's directory reads and opens (`WorkspacePanelSync.tsx:218`) | Lifecycle, not placement | **Still needed** |
| Q9 | Placement changes while closing: retain (`registry.go:918`), remove a window (`:778`), remove a cluster (`cluster_panel_close.go:160`) | Directory mutations; the directory is their only writer | No change |

The close sequences now hold no placement logic outside directory calls (Q9)
and the drain (Q7).

**Why the protocol checks stay (Q1, Q2, Q5).** The directory sees a move only
from acceptance (tab and cluster-view transfers) or begin (Float, dock-back)
until it ends. Before that, two kinds of request are known only to their
protocol: a request still waiting for its source to accept, and a cluster view
with no panels, which records no panel markers. A directory-only check would
need the directory to record each move when it is requested. That redesigns
the request and accept handshake, and this phase does not attempt it.

Measured (code only):

- **Production, Phase 5:** backend +18 / −0; frontend none.
- **Tests:** `TestClosingADockTargetDeclinesTheDockAtOnce` closes an unrelated
  app view (the dock stays pending), then the dock's target (the native window
  is live at once and keeps its panels).
- **Cumulative since main (Phases 0–5):** backend +655 / −632 (net +23);
  frontend +432 / −447 (net −15). Total net +8 code lines.
- **Mutation checks:** each mutation was reverted (verified with `cmp`).

  | # | Mutation | Tests that fail |
  | --- | --- | --- |
  | M30 | app-window close skips the decline | 1 |
  | M31 | the directory lists moves into every other window instead | 1 |
  | M32 | the directory lists every move | 0 |

  M32 survives by design: `FailPanelWindowTransfer`'s participant check
  (guarded by M21) rejects a decline from a window that is not the target. The
  `MovesInto` filter only saves that rejected call and its log line.

- **Evidence:** `go test` and `-race` pass on `appwindow` and `panelwindow`.

Phase 5 native checks. These need manual timing. Run them on macOS and Windows,
and for each, confirm no duplicate or lost panel and no error toast.

1. **Close the dock target.** In a native window, click **Dock to right**, then
   close the target app window before the tabs appear. The native window keeps
   its tabs and is interactive at once, not after 15 s.
2. **Close a new dock target.** Close every app window that shows the cluster
   (floating panels stay). In the native window, click **Dock to right**, then
   close the new app window that opens before it finishes loading. Expect the
   same result as check 1.
3. **Close another app view.** Open the cluster in two app windows. Dock a
   native window back, and close the app window that is *not* receiving the
   group while the dock runs. The dock completes into the other window.

## Native checks for John

These run in the real app (`mise exec -- wails3 dev`), on macOS and Windows,
with a dev kubeconfig. Check `settings.json` `kubeconfig.selected` first. For
each check, confirm three things:

- no duplicate tab across windows;
- no lost tab;
- no error toast.

1. **Float a group.** Use the Settings → Object Panel → Position control
   (`ObjectPanelSection.tsx:171`) and set Right.
   - Open two objects. Switch the second to YAML.
   - Click the header **Float panel** button (`DockablePanelControls.tsx:56`
     → `DockablePanelGroup.tsx:343` → `DockablePanelProvider.tsx:777` →
     `WorkspacePanelCoordinator` `handleGroupMove`).
   - Expect a native window with both tabs in order, the second tab active, and
     YAML showing. The right dock empties.
2. **Float right after a change.** Repeat check 1, but switch tabs and click
   Float within a second. Expect the same result and no error toast. This
   exercises the removed flush (G1).
3. **Default floating.** Set Position to Floating. Open an object from a table.
   - Path: auto-float via `pendingNativeOpen` (`useObjectPanel.ts:169`).
   - Expect it to open directly in a native window.
4. **Dock back.** In the native window, click **Dock to bottom**
   (`DockablePanelControls.tsx:67` native actions → `PanelWindowApp.tsx`
   `handleGroupMove`).
   - Expect the tabs in the app's bottom dock with order, active tab, and view
     kept. Existing bottom tabs stay first.
   - The native window closes.
   - Note any visible delay compared with main.
5. **Dock back to a background cluster.** In the app, open clusters A and B and
   make B active. Dock a native window of A.
   - Expect the app to switch to A, then the group to appear.
6. **Dock back with no app view.** Close the last app window; floating panels
   stay. In the native window, click **Dock to right**.
   - Expect a new app window for the cluster to receive the group.
   - This replaces the queued `dock-requested` delivery (G10).
7. **Tear-off** (it shares `BeginPanelWindowOpen`).
   - Drag a docked tab out of the app and drop it on the desktop
     (`DockablePanelProvider.tsx:690` → `Coordinator` `handleTabTearOff`).
   - Expect a new native window with that tab and the source tab gone.
   - macOS and Windows only.
8. **Drag between windows** (single-tab path; regression only).
   - Drag a native tab onto the app's dock strip, and an app tab onto another
     native window's strip.
   - Expect a move with no copy left behind.
9. **Close during transfer.** These cases need manual timing. The Go tests cover
   the exact interleavings.
   - Click Dock in the native window, then close the target app window before
     the tabs appear. Expect the native window to keep its tabs and become
     interactive within 15 s (the backend timeout). After
     [Phase 5](#phase-5-close-and-quit), expect this at once.
   - With unsaved YAML in a docked panel, click Float. Expect it to be blocked
     with focus on the editor.
   - With unsaved YAML in a native panel, click Dock. Expect the same.
10. **After the moves.**
    - Close a docked-back tab: it closes.
    - Close a floated window, then reopen the same object from the app: it
      opens fresh and does not focus a dead window.
    - Quit after the moves, then restart: the selections restore.

## Completion record

| Criterion | Status | Evidence |
| --- | --- | --- |
| Inventory of writers and guards | passed | sections above (main 59136764 line refs, verified with `git show HEAD:<file> \| grep -n` this session) |
| Transfer contract on the real directory and registry: no duplicate or lost panel on a stale snapshot or overlapping read; failed or cancelled transfer keeps the source | passed | `go test -race ./internal/panelwindow ./internal/appwindow ./internal/bootstrap/...` ok; new tests named above |
| Frontend projection | passed | `vitest run src/core/panel-windows src/PanelWindowApp.test.tsx`: 140 passed. The Sync and coordinator tests mock bindings and the dockable context |
| Complexity ≤ 12 on changed functions | passed | gocognit v1.2.1: max 12; `npm run complexity` on changed TS files: clean |
| Prerelease gate | passed | `mise exec -- wails3 task qc:prerelease` exit 0 on the final tree (docs, fmt, bindings, vet + staticcheck, `go test ./... -race` 107 packages ok, Biome, typecheck, frontend 5357 passed / 1 skipped, knip, trivy); no files reformatted |
| Native multi-window behavior | passed on macOS; Windows not run | John ran checks 1–10 on macOS on 2026-10-20 and reported all working |
| Phase 1 single-tab contract (directory and registry) | passed | `go test` (and `-race` on transfer packages) ok; tests named in [Phase 1](#phase-1-single-tab-transfer) |
| Phase 1 frontend projection and native acknowledgement | passed | Vitest: 168 passed (mocks bindings and dockable context; the guard-release test uses the real registry) |
| Phase 1 prerelease gate | passed | `mise exec -- wails3 task qc:prerelease` exit 0 (docs, fmt, bindings, vet + staticcheck, `go test ./... -race` 107 packages ok, Biome, typecheck, frontend 5356 passed / 1 skipped, knip, trivy); lint-fix re-sorted one export in `frontend/src/core/backend-api/index.ts` |
| Phase 1 native multi-window behavior | passed on macOS; Windows not run | John ran Phase 1 checks 1–10 on macOS on 2026-10-20 and reported them good |
| Phase 2 cluster-view contract (directory, registry, backend) | passed | `go test` and `-race` ok; tests named in [Phase 2](#phase-2-cluster-view-transfer) |
| Phase 2 frontend projection and cluster handoff | passed | Vitest 168 passed (mocks bindings, kubeconfig, and dockable context) |
| Phase 2 prerelease gate | passed | `mise exec -- wails3 task qc:prerelease` exit 0 (docs, fmt, bindings, vet + staticcheck, `go test ./... -race` 107 packages ok, Biome, typecheck, frontend 5356 passed / 1 skipped, knip, trivy); no files reformatted |
| Phase 2 native multi-window behavior | pending (John) | Phase 2 checks 1–9 |
| Phase 3 close and arrangement contract (directory, registry, backend) | passed | `go test` and `-race` ok; tests named in [Phase 3](#phase-3-close-as-an-intent) |
| Phase 3 frontend close intents | passed | Vitest 1210 passed (provider test uses the real `ObjectPanelStateProvider`; Sync and shortcuts mock bindings) |
| Phase 3 prerelease gate | passed | `mise exec -- wails3 task qc:prerelease` exit 0 (docs, fmt, bindings, vet + staticcheck, `go test ./... -race` 107 packages ok, Biome, typecheck, frontend 5359 passed / 1 skipped, knip, trivy); no files reformatted |
| Phase 3 native multi-window behavior | pending (John) | Phase 3 checks 1–7 |
| Phase 4 descriptor, report, and dock-target contract (directory, registry, backend) | passed | `go test` and `-race` ok; tests named in [Phase 4](#phase-4-native-index-without-snapshots) |
| Phase 4 frontend bootstrap and native report | passed | Vitest 197 passed (provider test uses the real `ObjectPanelStateProvider`; `PanelWindowApp`, shortcuts, and coordinator mock bindings) |
| Phase 4 prerelease gate | passed | `mise exec -- wails3 task qc:prerelease` exit 0 (docs, fmt, bindings, vet + staticcheck, `go test ./... -race` 107 packages ok, Biome, typecheck, frontend 5360 passed / 1 skipped, knip, trivy); Biome reformatted three edited files (`WorkspacePanelCoordinator.test.tsx`, `index.test.ts`, `PanelWindowShortcuts.tsx`), formatting only |
| Phase 4 native multi-window behavior | pending (John) | Phase 4 checks 1–6 |
| Phase 5 close declines moves into a closing app view (registry) | passed | `go test` and `-race` ok; `TestClosingADockTargetDeclinesTheDockAtOnce` |
| Phase 5 prerelease gate | pending | — |
| Phase 5 native multi-window behavior | pending (John) | Phase 5 checks 1–3 |
