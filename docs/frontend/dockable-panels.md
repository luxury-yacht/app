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
- A shared cluster workspace contains each object once across docked, native,
  and retained placements; every app view accesses that same collection.
- One native window represents one tab group with immutable
  `clusterId` and `groupId`. Tabs from different clusters never share a group.
- Docked and native renderers share the group chrome and object content
  contract. Native snapshots contain serializable identity and view state, not
  React nodes, refs, fetched data, credentials, drafts, or terminal buffers.
- Native panel windows reuse the workspace window chrome: macOS uses the
  transparent full-size titlebar with native traffic-light controls. Windows
  and Linux use a frameless window with minimize, maximize/restore, and close
  controls in the outer `AppHeader`; Windows also enables WebView2 non-client
  drag regions while retaining Wails' standard frameless decorations. Linux
  clears the framework's initial internal-name title. The outer `AppHeader`
  remains the drag/maximize surface, while the inner
  `DockablePanelHeader` remains tab and panel controls only. Workspace status,
  favorites, and command-palette controls do not render in the panel window.
- The shared directory is authoritative for panel location. A panel renderer is
  a projection and acknowledges changes through its owner.
- Transient unmounts such as workspace cluster switches preserve panel refresh
  state. Actual tab close evicts the current renderer's caches; a committed
  native handoff also evicts the source renderer's caches after the destination
  has reconstructed them. Eviction runs after React commits the removal, outside
  state updater callbacks; replayed renders must not reset shared refresh stores
  or notify their subscribers during rendering.
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
- Panel-header Dock, Float, Maximize/Restore, and Close controls apply to the
  complete tab group. Moving between dock edges appends the whole source group
  to an occupied destination, preserving source order and its active tab.
- A panel tab's context menu applies only to that tab, including an inactive
  tab. It offers the other dock edge and Float for docked tabs, both dock edges
  for native tabs, and Close. Native tab docking resolves an app view of the
  same cluster and waits for that renderer's readiness before insertion.
  Cancelled transfers must not deliver a queued insertion after startup.
- If an object is already docked, focus its owner and docked tab. If it is in a
  native group, focus that window and tab.
- A same-cluster link opened in a child may join that child group after owner
  authorization. A cross-cluster link routes to the matching owner slice and is
  rejected with an actionable error when that cluster is not open.
- Dragging within a tab bar reorders one tab. Dragging between compatible tab
  bars moves that one tab, including workspace-to-native, native-to-workspace,
  and native-to-native moves within the same cluster. Cross-cluster drops are rejected.
- Rejected cluster combinations show no insertion indicator. Panel drag
  scope is available during protected dragover; drop-time and backend checks
  still authorize the actual transfer.
- On macOS and Windows, dropping an unconsumed tab drag outside a workspace or a
  native source creates a new one-tab native window near the pointer, using the
  configured floating size and the pointer's monitor work area. Moving the last
  tab closes the empty native source after destination acknowledgement. A failed
  transfer retains the source window and its tab. This differs from
  the Float button, which always transfers the complete current group. On macOS,
  the shared native drag policy recognizes both dockable-tab and cluster-tab MIME
  markers and suppresses AppKit's failed-drop return animation because an accepted
  tear-off is intentionally represented as `dropEffect: none` by the source webview.
- Linux drag-out to a new window is deferred for this release. Use Float to
  transfer the entire current panel group into a native window. Tab reordering
  and moves between existing compatible panels remain in the release scope.

## Acknowledged Handoffs

Float, dock-back, panel-tab moves, and cluster-tab moves are acknowledged
transactions. Check source guards and flush its latest snapshot before transfer.
The source stays mounted while the target reconstructs the panels. The shared
backend directory commits physical placement only after destination readiness.
Opening an already-open object focuses the existing placement. Every app window
displaying the cluster can access the shared panel collection from its cluster
tab’s context menu.

A tab drag carries the actual source window/group, cluster, complete object
identity, and active sub-tab. Cross-cluster targets must be rejected. Existing
targets publish the exact tab before commit; newly created native targets
acknowledge readiness. Provisional target groups must not claim source panels
prematurely. Failures and timeouts remove provisional target copies. A source
native window closes when its final tab commits elsewhere.

Dock-back moves the entire same-cluster group into right or bottom, preserving
order and active views. Appending to an occupied group preserves existing tabs.
Cluster-tab movement carries docked groups and local navigation, while floating
panel windows keep their positions and cluster identity.

## Refresh and runtime state

A panel window uses a fixed-cluster provider. Its visible content owns scoped
refresh demand; hiding or minimizing releases visible demand while retaining
cached data. The shared panel collection and live native window retain cluster
runtime independently of any app window’s cluster tabs.

Object and view identity transfer. Shared refresh data rebuilds detail, YAML,
events, map, and logs. Shells reconnect by backend session identity. Unsaved YAML,
saves, and mutations block renderer disposal. Native geometry is process-local.
The visible header identifies the cluster, with full identity available in its
tooltip when the text is truncated.

Each renderer serializes its snapshots and flushes before moving or closing.
A transfer freezes user interaction until commit or rollback. Native panels do
not publish through an originating app window. Shared directory revisions drive
app-view reconciliation and retained-panel restoration.

Close preparation checks blockers before awaiting publication. A cluster-tab
close guards only that cluster's content, including menus rendered through
portals; it does not display a full-window closing overlay. Other cluster tabs
and global navigation remain usable. App-window close, Quit, and transfers retain
their renderer-wide guards.

Window-wide guards preserve the visible content. Transfers, window close, and
Quit show a compact corner status only after 500 ms; they never blank the window
with a status overlay. Input freezes immediately, independently of the delayed
indicator, and settlement removes the status and cancels any pending delay.

Before the backend removes an app view's cluster membership, shared-panel
synchronization pauses new directory reads and object opens for that cluster,
drains admitted calls, and flushes queued publications. Docked publications replace
the entire renderer snapshot, so new publications wait until accepted closures
appear in the frontend selection. Rejected closes resume synchronization. The
close preparation lease keeps input guarded through the selection transition;
duplicate or stale close requests must not reach the backend again.

Incoming transfers must reject a renderer frozen by another transaction, even
when the transferred cluster has no panels. A transaction may finish its own
reconstruction while its freeze is active.

## Close ordering

- Panel-tab close: guard locally, obtain registry authorization, remove a
  non-final tab locally and publish the remaining snapshot. Preserve a final
  tab until its native window close commits.
- Panel-window close: guard the group, close the native window, then remove its
  shared entries and release its runtime reference.
- Cluster-tab close: guard and flush local docked panels. If another app window
  still displays the cluster, release only this view and retain its shared
  panels. For the final app view, preflight every native panel window belonging
  to that cluster, close them only after all approve, discard the shared panel
  collection, then remove the cluster tab. Denial, timeout, or a pending transfer
  preserves the tab. Approved renderers stay frozen until the transaction settles.
- App-window close: guard and flush local docked panels, retain their shared
  identities, and release that app view. Floating panels remain open.
- Application quit: preflight every ready app and panel renderer. Close none
  until every participant approves. Approved renderers remain frozen while their
  peers decide and through successful process shutdown. After unanimous approval,
  request application Quit so per-view close hooks do not remove saved clusters.
  Settlement releases every original participant, including those that already
  approved, on denial, timeout, delivery failure, or rejected quit handoff.
  A renderer ignores a late request for a transaction it has already settled.

## Change Checklist

1. Trace complete object identity from the initiating link/action through the
   shared directory and snapshot.
2. Prove the source remains live until target acknowledgement and remains
   unchanged on failure or timeout.
3. Verify dock-right, dock-bottom, native float, dock-back, group order, active
   tabs, uniqueness, and focus.
4. Verify cluster switching does not rewrite cluster identity or app-view
   membership, and panel visibility controls only its scoped demand.
5. Exercise clean, unsaved-YAML, saving, and mutation-in-flight guards across
   move, tab close, titlebar close, cluster close, app-window close, and quit.
6. Add reducer/protocol tests and visible component tests. Run typecheck and the
   targeted dockable, object-panel, shortcut, and appwindow suites.
7. On macOS and Windows, exercise cluster and panel tab moves with both one and
   multiple tabs, targeting new and existing windows. Verify object identity,
   active view, drop placement, phantom animation, and empty-source closure.
   Cancelled or failed transfers must preserve the source content. On Linux,
   record drag-out as deferred; still test reordering, moves between existing
   compatible panels, Float, and dock-back.
8. Open the same cluster in two app windows and find/focus its shared panels
   from either view. Closing one cluster tab retains the shared panels; closing
   the final cluster tab closes its panels after all guards approve. Separately
   close the last app window and dock a surviving floating panel back into a
   newly created app view.
9. Quit with different clusters in two app windows and with native panel windows
   open. An unsaved draft must block quit and leave the other renderer usable.
   After a clean quit, restart and confirm both cluster selections restore.

Native validation must include an actual destination drop. Drag-over events or
a visible insertion indicator alone do not establish transfer success. If
automation delivers only hover, use a manual drop and inspect content retention
and empty-source closure, following the
[completion evidence gate](../workflows/completion.md).

### Programmatic keyboard focus

`DockablePanelProvider.focusPanel(panelId, clusterId)` owns deferred focus for
new and existing panels. Callers pass the owning cluster when activating another
cluster. The provider waits for group membership and active-tab rendering before
focusing the actual tab. This request survives an initiating object view
unmounting, is replaced by a newer request, and is discarded when leaving its
cluster. Pending DOM-focus callbacks are canceled on rerender or provider cleanup.
`useObjectPanel` and workspace focus events delegate to this owner; they must not
keep their own registration waits inside content that opening the panel replaces.
