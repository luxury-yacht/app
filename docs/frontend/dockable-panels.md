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
  has reconstructed them.
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
- Rejected owner/cluster combinations show no insertion indicator. Panel drag
  scope is available during protected dragover; drop-time and backend checks
  still authorize the actual transfer.
- On macOS and Windows, dropping an unconsumed tab drag outside a workspace or a
  multi-tab native source creates a new one-tab native window near the pointer, using the
  configured floating size and the pointer's monitor work area. Dragging the
  only tab out of a native source leaves that window unchanged because replacing
  it with an equivalent one-tab native window has no effect. This differs from
  the Float button, which always transfers the complete current group. On macOS,
  the native drag session recognizes the dockable-tab MIME marker and suppresses
  AppKit's failed-drop return animation because an accepted tear-off is
  intentionally represented as `dropEffect: none` by the source webview.
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

## Close ordering

- Panel-tab close: guard locally, obtain registry authorization, remove a
  non-final tab locally and publish the remaining snapshot. Preserve a final
  tab until its native window close commits.
- Panel-window close: guard the group, close the native window, then remove its
  shared entries and release its runtime reference.
- Cluster-tab or app-window close: guard and flush local docked panels, retain
  their shared identities, and release that app view. Floating panels remain open.
- Application quit: preflight every ready app and panel renderer. Close none
  until every participant approves. Denial or timeout preserves all renderers.

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
7. On macOS and Windows, exercise single-tab drag-out from a workspace and a
   multi-tab native window. On Linux, record drag-out as a deferred limitation;
   still test tab reordering, moves between compatible existing panels, Float,
   and dock-back. Check that an attempted drag-out or Escape preserves the source
   tab and its contents.
