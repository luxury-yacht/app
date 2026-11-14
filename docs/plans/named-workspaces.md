# Named workspaces

Save and reopen a named arrangement of all Luxury Yacht app windows and
floating panel windows. Updating a saved workspace is an explicit action.

## Save

The native window registry supplies live window membership and geometry. The
cluster workspace coordinator supplies each app window's cluster membership and
visible cluster. Each renderer supplies its displayed tab order, retained routes,
table state, and dock dimensions. The panel directory supplies the placement and
identity of docked and floating tabs. Reuse the cluster-tab handoff's existing
capture for cluster navigation and table state.

Collect those values before committing through `UIStateStore`. Compare the
participants and placement revisions before and after capture. A renderer closing
or a panel moving during capture must leave the prior saved layout available.
Send capture requests after the renderers can receive them, and wait outside the
registry, directory, and store locks so replies can advance readiness. Assign
saved placements to window entries in the snapshot so restore can use fresh
process-local window identities.

## Open

Run the current desktop's close guards, close its windows, then load the saved
ones as ordinary windows with their cluster selections, routes, table state,
and panel placements. Restore a shared panel once even when the cluster appears
in multiple app windows. A disconnected cluster should enter its normal
connection lifecycle while other windows restore.

The switch does not roll back. An earlier design staged the new windows hidden
inside the running app and swapped only when all had mounted, so that a
renderer failure left the current desktop usable. Four review rounds kept
finding shared state the staged windows changed before the swap (cluster
connections, the restart selection, table and tab-order persistence, themes),
and that requirement was dropped on 2026-11-12: a saved window that fails to
load is shown as it is with a warning, and the saved workspace is untouched, so
it can be opened again.

Use the existing logical work-area handling for each restored window. Capture
and verify the normal bounds of maximized windows. Shell and port-forward
sessions, drain jobs, and unsaved editor content stay with their live owners.

## Acceptance evidence

- **Disk round-trip.** `TestNamedWorkspaceKeepsEachWindowsLayoutAcrossRestart`
  exercises the real UI state store with two app windows on the same cluster,
  independent table filters, and a floating Logs window. It reloads the file
  through a fresh store with the config directory redirected to a temporary path.
- **Global and dock state.** `TestNamedWorkspaceKeepsGlobalAndDockedViews`
  round-trips a Global view and docked panel, then verifies a duplicate panel
  placement cannot overwrite the prior snapshot.
- **Live save.** `TestCaptureNamedWorkspaceWaitsForEveryAppWindow` covers the
  readiness gate and rejects stale replies.
  `TestCaptureNamedWorkspaceRejectsAWindowClosingDuringCapture` verifies that a
  window closing during capture aborts the attempt and allows a retry.
  `TestCaptureNamedWorkspaceKeepsDockedAndFloatingPanels` exercises the native
  registry and panel directory with geometry and renderer replies supplied by
  the test. The Command Palette test checks that replacing an existing name
  submits an explicit replacement.
- **Native save on macOS.** In an isolated development build with Wails MCP,
  saved two app windows with independent views of the same Kind cluster and a
  floating Node panel. Checked all three logical window bounds and the saved
  panel reference against the native window inventory. Replaced the workspace
  after adding staging to the first window and production to the second.
  The file contained the expected per-window cluster memberships.
- **Panel transfer admission.** `TestWorkspaceCaptureWaitsForThePanelMoveToSettle`
  exercises the real panel directory. It blocks capture during a move and
  admits a retry once the move settles.
- **Open and switch (staged design, superseded).** The registry tests covered
  close denial, a failed native window factory, and committing new app and
  floating windows after their readiness replies. The frontend harness verifies the saved dock is projected
  before its acknowledgement. The isolated macOS app reopened the original
  saved workspace after quit, then switched between it and a second layout with
  a docked Node panel, a floating Node panel, and independent Nodes filters.
  A dirty CodeMirror YAML draft denied a native switch and remained in the same
  window after the denial. The draft was never submitted.
- **Native placement on macOS (staged design).** The restored normal windows matched their
  saved bounds. The maximized window recovered its original normal bounds after
  unmaximizing. An isolated fixture with coordinates outside the available work
  areas verified the fallback placement on a real native window. A physical
  display disconnect and Windows and Linux placement were not exercised.
- **Unavailable context (staged design).** The final isolated build reopened the available
  clusters and named the missing saved context in a visible warning.
- **Simple switch on macOS (native, no cluster).** In an isolated development
  build, a one-window desktop opened a saved three-window workspace. The first
  saved window existed, hidden, while the previous window was still open; the
  previous window then closed, and within about 0.6 seconds all three saved
  windows were present fullscreen, minimized, and maximized. The app did not
  quit in between. Leaving each state returned the window to exactly its saved
  bounds. A second switch from a restored window opened a workspace with two
  fullscreen windows and a maximized one, and a third was started from the Open
  Workspace dialog. Workspaces saved by the earlier build were given revisions
  on first listing and kept them. A new save, a replace, and the refusal of
  replace, rename, delete, and open with an out-of-date revision behaved as
  designed, and the refused open left the windows untouched. Rename and delete
  were exercised through the dialog. File > New Window worked after a switch,
  and the app quit cleanly. Not exercised: cluster tabs, docked or floating
  panels, a saved window that fails to load, the warnings, Windows, and Linux.
- **Simple switch (automated).** The earlier native runs of open and switch
  marked "staged design" below do not cover this one.
  `TestSwitchClosesThePreviousWindowsThenShowsTheSavedOnes` covers the order:
  saved windows created hidden, the last previous window hidden, saved windows
  shown, that window closed, previous clusters released, restart selection
  written. `TestSwitchWhoseOnlySavedWindowFailsOpensAPlainWindow` covers a
  workspace of one panel window that fails to start: the wait ends at once,
  its panels leave the directory, a plain window opens with the warning, and a
  native window exists throughout.
  `TestSavedAppWindowThatDoesNotLoadKeepsNothingOfItsSavedView` covers an app
  window that fails or never answers: it stays open, its docked panels leave
  the directory, and a late page is not told to restore.
  `TestSwitchDoesNotWaitForASavedWindowThatCanNoLongerAnswer` covers a saved
  window whose renderer goes or that is closed before it loads.
  `TestSwitchDoesNotReportAPreviousWindowThatIsAlreadyGone`,
  `TestRemovingAClusterEndsTheRequestItsPanelWindowsWereAsked`, and
  `TestClusterCloseDoesNotCommitDuringAWorkspaceSwitch` cover a cluster that
  is removed or closed while a switch or quit is under way.
  `TestWindowAskedToApproveASwitchCannotCloseOnItsOwn` covers a window that
  tries to close after it was asked, and the selection written when the new
  workspace is on screen. `TestSwitchWaitsForAClusterCloseToFinish`,
  `TestSavedAppWindowThatCouldNotStartIsNotTheOnlyWindowLeft`, and
  `TestSavedAppWindowStillWorkingAtTheDeadlineKeepsItsDockedPanels` cover the
  cases their names give.
  `TestSwitchIsRefusedWhenAWindowOpensWhileTheOthersApprove` covers a window
  that opens during the approvals, and
  `TestPanelsSetAsideForANamedWorkspaceFollowTheirWindowsAndClusters` the
  set-aside panels of a window or cluster that goes during the switch.
  `TestSwitchRefusedBeforeTheHandOverChangesNothing` covers a changed panel
  directory and a cancelled request.
  `TestSavedWindowsThatDoNotLoadAreShownAndReported` covers a window that fails
  to load, one that never answers, and one that cannot be created.
  `TestRestoredPanelWindowThatNeverLoadsIsClosed`,
  `TestRestoredWindowIsShownByTheSwitchNotByItsRuntime`,
  `TestRestoredWindowOwnsItsDockedPanelsLikeAnyOtherWindow`,
  `TestNewWindowIsRefusedDuringASwitch`,
  `TestClosingEverySavedWindowDuringTheSwitchQuitsTheApp`, and the warning tests
  cover the rest. `TestNamedWorkspaceSwitchWritesTheRestartSelectionOnce`
  runs against the real workspace coordinator.
- **Save (automated only).** `TestCaptureEndsWhenAWindowClosesBeforeAnswering`,
  `TestSaveAndSwitchWaitForAClusterViewMoveToFinish`,
  `TestCaptureRefusesAClusterViewMoveThatStartsWhileItWaits`,
  `TestSaveAndSwitchWaitForARendererThatCanAnswer`, and
  `TestCaptureNamedWorkspaceReportsAWindowsFailure` cover admission and early
  exits. `TestNamedWorkspaceChangesApplyOnlyToTheListedSnapshot` and
  `TestNamedWorkspaceSavedBeforeRevisionsIsStampedWhenListed` cover revisions,
  and the Command Palette tests cover the dialogs passing them.
- **Renderer readiness (automated only).** A window is asked to save, switch,
  or quit only while its renderer has announced readiness since its last page
  load. `TestWindowThatReloadsIsNotAskedUntilItsRendererIsBack`,
  `TestWindowThatWithdrawsReadinessIsLeftOutUntilItAcknowledgesAgain`, and
  `TestPanelWindowTakesPartOnlyWhileItsRendererHasAcknowledged` cover the
  registry. `WorkspacePanelSync.test.tsx` covers an app window staying
  announced through a kubeconfig reload, withdrawing when its tree unmounts,
  and the withdrawal landing after the announcement. `PanelWindowApp.test.tsx`
  covers a panel window announcing, withdrawing, and announcing again when its
  tree remounts in the same page, and a window that reloaded in the middle of
  a move becoming ready once the move is rolled back.
  `TestRequestEndsWhenAnAskedWindowCanNoLongerAnswer` covers a save and a quit
  ending at once when an asked window withdraws,
  `TestWindowWhoseCloseIsRefusedStillTakesPart` a window whose close the
  closing hook refused, and
  `TestPanelWindowThatAnnouncesWhileDockingTakesPartOnceLive` an announcement
  made mid-dock. Not run in a native window: a real reload and the crash
  screen.
- **Switch that can create no window.**
  `TestNamedWorkspaceKeepsCurrentWindowsWhenNoSavedWindowCanBeCreated` covers
  the current windows keeping their panels and what was recorded for them;
  `TestNamedWorkspaceReplacesAppAndPanelWindows` covers a switch that goes
  ahead reporting only the panels it did not open again as closed.
- **Workspace of panel windows alone.**
  `TestNamedWorkspaceSwitchWritesTheRestartSelectionOnce` covers
  its clusters becoming the next launch's selection.
- **Window state on macOS (native, staged design).** In an isolated development build with no
  cluster, three app windows were saved fullscreen, minimized, and maximized.
  The minimized window and the one in its own fullscreen space both answered
  the capture. The saved file held each window's normal bounds and its state.
  Reopening restored all three states, and leaving each state returned the
  window to exactly its saved bounds. Saving the reopened workspace again kept
  the same bounds. Two findings came from this run and were fixed: a window
  maximized while another entered fullscreen was left part-way, so fullscreen
  is now entered last, and of two windows asked to enter fullscreen together
  only one did, so they now enter in turn. Both were re-run after the fix.
  Rename and delete were exercised through the Open Workspace dialog. Not
  exercised: resizing below the minimum size after leaving fullscreen, the
  failed-close paths, Windows, and Linux.
