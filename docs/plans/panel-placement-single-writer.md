# Panel placement: single-writer prototype (finding #4)

Status: on `single-panel-writer`, Phase 0 (whole-group **Float** and
**dock-back**, `e1d3b937`) and Phase 1 (**single-tab transfer**, `64595908`)
are committed, and both passed John's native checks on macOS. Phase 2
(**cluster-view transfer**) is in the working tree, uncommitted, and awaits its
native checks ([Phase 2](#phase-2-cluster-view-transfer)). Close and the native
index are unchanged.

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
ID (:212).

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
| G14 | A native snapshot cannot adopt another window's pending op | `panel.go:211` | **Still needed** until the index stops storing snapshots (Phase 4). | — |
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
  should merge the two transfer records.
- **Dock-back needs one extra round trip.** The target learns of the move from
  `panel-workspace:changed` followed by `GetPanelWorkspace`, instead of from an
  event payload. The cost is not measured here [unverified]; native check 4
  observes it.
- **A stale publication can still be rejected after commit.** It happens only if
  a queued source publication lands after the native window has booted and
  acknowledged. The result is an error report, never a lost or duplicated panel
  (G15). The race window has not been measured [assumed rare].
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
3. **Close as an intent.** Tab close calls the directory. Publications never
   delete panels, so the following go away:
   - `unpublished`;
   - the "docked publications replace the whole snapshot" pause in cluster
     close (G13 context).
4. **Native index without snapshots.**
   - Build the descriptor from the directory.
   - Delete `UpdatePanelWindowSnapshot`'s second write, `panelIndex.snapshots`,
     and the adoption guard (G14).
   - Make the directory move the only transfer record.
5. **Close and quit.** Preflights query pending moves from the directory. No
   placement logic remains in the close sequences.

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
     interactive within 15 s (the backend timeout).
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
