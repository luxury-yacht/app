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

Run the current desktop's close guards before replacement. Stage the new windows
with their cluster selections, routes, and table state, then commit panel
placements after their destination renderers acknowledge mounting. Restore a
shared panel once even when the cluster appears in multiple app windows. A
renderer failure must leave the current desktop usable. A disconnected cluster
should enter its normal connection lifecycle while other windows restore.

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
- **Open and switch.** The registry tests cover close denial, a failed native
  window factory, and committing new app and floating windows after their
  readiness replies. The frontend harness verifies the saved dock is projected
  before its acknowledgement. The isolated macOS app reopened the original
  saved workspace after quit, then switched between it and a second layout with
  a docked Node panel, a floating Node panel, and independent Nodes filters.
  A dirty CodeMirror YAML draft denied a native switch and remained in the same
  window after the denial. The draft was never submitted.
- **Native placement on macOS.** The restored normal windows matched their
  saved bounds. The maximized window recovered its original normal bounds after
  unmaximizing. An isolated fixture with coordinates outside the available work
  areas verified the fallback placement on a real native window. A physical
  display disconnect and Windows and Linux placement were not exercised.
- **Unavailable context.** The final isolated build reopened the available
  clusters and named the missing saved context in a visible warning.
- **Review fixes (automated only).** Registry tests cover a window's capture
  failure reply, refusing an unrestorable workspace before the close guards,
  dropping app windows whose saved clusters are all missing, an approval that
  outlives its collection timeout, and a floating panel window's remembered
  normal bounds. `TestNamedWorkspaceSeedCannotOvertakeLastOwnerRemoval` covers a
  seed that arrives while a cluster's last owner is being removed.
  `TestNamedWorkspaceDeleteRemovesOnlyTheNamedSnapshot` and the Command Palette
  test cover deleting a saved workspace. None of these were re-run in the native
  window.
