# Dockable and Native Panel Windows Contract

Object panels can be docked on the workspace's right or bottom edge, or moved
as a complete tab group into an ordinary native application window. “Floating”
is a product action that creates that native window; there is no in-page HTML
floating, viewport-relative geometry, or blank-space drag. Docked panels retain
their existing in-page maximize behavior; native panel windows use OS window
maximize and restore.

## Agent Contract

- Panel tabs preserve complete object identity: `clusterId`, `group`,
  `version`, `kind`, `namespace`, and `name`.
- Opening an object goes through the object-panel and native-panel boundaries;
  feature code must not splice panel location state directly.
- One owner workspace may contain an object only once across its docked and
  native groups. Another workspace may open the same object independently.
- One native window represents one tab group with an immutable owner,
  `clusterId`, and `groupId`. Tabs from different clusters never share a group.
- Docked and native renderers share the group chrome and object content
  contract. Native snapshots contain serializable identity and view state, not
  React nodes, refs, fetched data, credentials, drafts, or terminal buffers.
- Native panel windows reuse the workspace window chrome: macOS uses the
  transparent full-size titlebar with native traffic-light controls, while
  Windows and Linux retain their native frame controls without a native menu
  bar or title text. Linux clears the framework's initial internal-name title
  and hides its inherited application-menu widget before the hidden window is
  shown. The native window's outer `AppHeader` is the drag/maximize surface; the
  inner `DockablePanelHeader` remains tab and panel controls only. Workspace
  status, favorites, and command-palette controls do not render in the panel
  window.
- The owner directory is authoritative for panel location. A child renderer is
  a projection and acknowledges changes through its owner.
- Transient unmounts such as workspace cluster switches preserve panel refresh
  state. Actual tab close is the cache-eviction boundary.
- Menus and other transient surfaces render through their shared body-level
  portal. Do not weaken scrolling or overflow boundaries to expose them.

## Ownership

- Docked group state and rendering: `frontend/src/ui/dockable`
- Native protocol, owner coordination, and lifecycle guards:
  `frontend/src/core/panel-windows`
- Object identity, per-cluster directory, and cache eviction:
  `frontend/src/modules/object-panel`
- Native role and transfer registry: `internal/appwindow`, with serializable
  DTOs in `internal/panelwindow`
- Shared tab behavior: [tabs.md](tabs.md)
- Keyboard and focus behavior: [keyboard.md](keyboard.md)
- Native close and application lifecycle:
  [application-lifecycle.md](../architecture/application-lifecycle.md)

## Placement and Uniqueness

- Prefer the active compatible docked group when opening a new object.
- A new panel whose default is Floating creates a uniquely isolated, transient,
  hidden one-tab source group, then asks the native coordinator to transfer it.
  It never joins a focused floating group whose transfer is already pending.
- An explicit Float action transfers the complete current docked group,
  including every tab in that group.
- If an object is already docked, focus its owner and docked tab. If it is in a
  native group, focus that window and tab.
- A same-cluster link opened in a child may join that child group after owner
  authorization. A cross-cluster link routes to the matching owner slice and is
  rejected with an actionable error when that cluster is not open.
- Dragging within a tab bar reorders one tab. Dragging between compatible tab
  bars moves that one tab, including workspace-to-native, native-to-workspace,
  and native-to-native moves under the same owner and cluster. Cross-owner and
  cross-cluster drops are rejected.
- Dropping an unconsumed tab drag outside its source window creates a new
  one-tab native window near the pointer, using the configured floating size
  and the pointer's monitor work area. This differs from the Float button,
  which always transfers the complete current group. On macOS, the native drag
  session recognizes the dockable-tab MIME marker and suppresses AppKit's
  failed-drop return animation because that otherwise-successful tear-off is
  intentionally represented as `dropEffect: none` by the source webview.

## Acknowledged Handoffs

Float, dock-back, and cross-window tab moves are transactions. Before a group
move, the source checks every tab guard and creates a complete group snapshot.
An explicit Float source stays visible until the target has reconstructed the
group and acknowledged readiness. A new default-Floating panel keeps its source
registration and group mounted but suppresses its workspace surface during
that same interval. The owner then commits each location exactly once and
unmounts the source. A failed, stale, or timed-out explicit Float leaves its
source unchanged; a failed default-Floating open reveals the new panel by
docking its source on the right. Opening has one terminal owner outcome: if
readiness succeeds but the opened event cannot reach the owner, the registry
closes and removes the native target and reports the failed transfer. A native
target that has already disappeared still produces the same owner-side closed
outcome.

A tab drag carries the source window, immutable owner, cluster, source group,
complete object identity, and active object sub-tab. The registry reserves the
source tab for one transfer and asks the owner to validate its authoritative
directory entry. The source remains mounted while the destination reconstructs
the tab. An existing native destination publishes a snapshot containing the
exact tab before commit; a new native destination acknowledges window
readiness; a workspace destination waits until its docked tab is mounted. Only
then does the source remove the tab. Failure or timeout removes a provisional
destination and leaves or restores the source. Removing the final tab closes
the now-empty native source.

Dock-back moves the entire native group to right or bottom while preserving tab
order, active tab, and active object sub-tabs. Dragging one child tab moves only
that tab; the Float and dock-back buttons remain group-wide actions.

## Refresh and Runtime State

A panel child uses a fixed-cluster provider from its immutable descriptor; it
does not register a workspace or cluster-tab owner. Switching the owner's
active cluster does not retarget or hide the child. Visible child content owns
its normal panel-scoped refresh demand. Hiding or minimizing releases visible
demand while retaining cached data; restoring paints retained data and
reacquires the scopes.

Object and view identity transfer. Read-only detail, YAML, events, map, and log
data are reconstructed from the shared refresh system. Shells reconnect by
backend session identity. Unsaved YAML drafts, YAML saves, and in-flight
mutations do not transfer and block moves and closes until resolved. Native
geometry is not persisted for relaunch.

The child is the sole producer of live group snapshots. It serializes snapshot
writes so an older tab or view state cannot arrive after a newer state. The
owner commits object additions, non-final tab removals, and active-view changes
from those acknowledged snapshots rather than mutating its directory before
the child applies an authorization.

## Close Ordering

- Active-tab close: guard the tab and ask the owner to authorize it without
  changing the directory. For a non-final tab, the child releases its local
  state and publishes the resulting snapshot; the owner commits that snapshot.
  For the final tab, the child preserves local state until native close commits,
  and the owner removes it from the closed event.
- Native titlebar close: guard the whole group, preserve child and owner state
  until the native close commits, then remove the group from the closed event.
- Cluster-tab or owner close: guard matching docked panels and children, close
  children, then release the existing workspace/cluster ownership.
- Application quit: all ready workspaces preflight first; no owner closes until
  every owner approves.
All asynchronous handoff and close timeouts fail closed and preserve the source
state.

## Change Checklist

1. Trace complete object identity from the initiating link/action through the
   owner directory and snapshot.
2. Prove the source remains live until target acknowledgement and remains
   unchanged on failure or timeout.
3. Verify dock-right, dock-bottom, native float, dock-back, group order, active
   tabs, uniqueness, and focus.
4. Verify cluster switching does not rewrite child identity or workspace
   ownership, and child visibility controls only its scoped demand.
5. Exercise clean, unsaved-YAML, saving, and mutation-in-flight guards across
   move, tab close, titlebar close, cluster close, owner close, and quit.
6. Add reducer/protocol tests and visible component tests. Run typecheck and the
   targeted dockable, object-panel, shortcut, and appwindow suites.
