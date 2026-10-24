# Dockable and Native Panel Windows Contract

Object panels dock on the workspace's right or bottom edge or move, as a whole
tab group, into an ordinary native window ("Float"). There is no in-page HTML
floating, viewport-relative geometry, or blank-space drag. Docked panels keep
in-page maximize; native panel windows use OS maximize/restore.

This doc owns renderer placement, handoffs, and close sequences. Backend
directory, registry transactions, lock ordering, runtime retention, and window
chrome:
[application lifecycle](../architecture/application-lifecycle.md#cluster-owned-panel-workspaces).
Tab rendering and drag payloads: [tabs.md](tabs.md). Keyboard:
[keyboard.md](keyboard.md).

## Ownership

- Docked group state and rendering: `frontend/src/ui/dockable`
- Native protocol, owner coordination, lifecycle guards:
  `frontend/src/core/panel-windows`
- Object identity, per-cluster directory, cache eviction:
  `frontend/src/modules/object-panel`
- Native role and transfer registry: `internal/appwindow`; DTOs:
  `internal/panelwindow`

## Contract

- Open objects through the object-panel and native-panel boundaries; feature
  code must not splice panel location state.
- A shared cluster workspace holds each object or observed identity once across
  docked, native, and retained placements; every app view sees it. Identity
  targets keep exact User/Group names and no object reference. Both target
  types use the `obj:` panel ID prefix for layout preferences; identity IDs
  encode cluster, subject kind, and name.
- Every object target is built by `buildObjectPanelRef`, which gives a
  registered kind its registry spelling. Object panel IDs ignore the kind's
  case, and the directory refuses a known panel ID whose object reference
  differs (`internal/panelwindow/workspace.go`), so a ref built any other way
  breaks reopening from a lowercase link.
- One native window holds one same-cluster group; clusters never share a group.
- Renderers project the shared directory and acknowledge changes through its
  owner.
- The directory is the only writer of which renderer and group hold a panel.
  Each renderer writes only the order, activation, edge, and view of the panels
  in its groups. Directory-owned arrangement was rejected: it needs a
  `DockablePanelProvider` rewrite and a directory round trip on every reorder.
- Docked and native renderers share group chrome and object content. Native
  descriptors and arrangement reports hold serializable identity and view state
  only: no React nodes, refs, fetched data, credentials, drafts, or terminal
  buffers.
- Panel windows reuse workspace chrome: `WindowHeader` is the drag/maximize
  surface; `DockablePanelHeader` holds only tab and panel controls. Workspace
  status, favorites, and command palette never render there.
- Every panel header shows its cluster name (else cluster ID; duplicate names
  add the ID), with full identity in a tooltip when truncated.
- Transient unmounts (such as cluster switches) preserve panel refresh state.
  Tab close evicts the current renderer's caches; a committed native handoff
  evicts the source's caches after the destination reconstructs. Evict after
  React commits the removal, outside state updaters; replayed renders must not
  reset shared refresh stores or notify subscribers.
- Menus and transient surfaces use their shared body-level portal; never weaken
  scrolling or overflow boundaries to expose them.

## Placement and uniqueness

- Each renderer's cluster-scoped tab groups are its single writable placement
  projection: groups own size, maximize, and stacking; tabs own open state;
  object state holds local references, active views, and pending native opens.
  No second dock-edge or native-window index.
- `useRestoreWorkspacePanels` installs group membership before restoring content
  for retained panels, dock-back, panel-tab insertion, and cluster-view
  insertion. A mounting `DockablePanel` keeps that membership; its initial
  closed state must not remove the group.
- `PanelLayoutLifecycle` releases tab state and membership after committed
  removal in both renderer roles. Dock geometry stays with its group through
  sibling closes, reorders, and cluster switches. An empty dock keeps its size
  but releases maximize. Object-panel size settings update empty docks and
  groups with object tabs; occupied utility-only groups keep their size.
  Removed floating groups release layout state. Focus and debug readers use
  their provider's group state; there is no global layout store.
- `DockablePanelLayer`, mounted inside each renderer's content surface, renders
  one `DockablePanelGroup` per visible group (chrome, geometry, keyed DOM slot
  per tab). `DockablePanel` portals its children into its slot, keeping its
  context and error boundary; there is no tab leader, captured-children
  registry, or content-change channel. Sibling opens/closes and reorders keep
  slots and editing state; moving a tab or group to another dock remounts its
  content (shell and log views too) and must respect lifecycle guards. React
  owns host replacement; the provider must not append a one-time DOM container.
- A new object prefers the active compatible docked group. An already-open
  object focuses its placement: owner and docked tab, or native window and tab.
- A new panel defaulting to Floating creates a uniquely isolated, hidden,
  transient one-tab source group and asks the native coordinator to transfer
  it; it never joins a floating group whose transfer is pending.
- Panel-header Dock, Float, Maximize/Restore, and Close act on the whole group.
  Changing dock edge appends the whole group to an occupied destination, keeping
  source order and active tab.
- Only object panels can float. The workspace owner supplies `canFloatPanel`;
  the header offers Float only when every tab can float, so a group holding an
  app-wide panel (Application Logs, Diagnostics) stays docked.
- A panel tab's context menu acts on that tab only, even when inactive: docked
  tabs offer the other edge and, for an object panel, Float; native tabs both
  edges; all Close.
  Docking a native tab resolves a same-cluster app view and waits for its
  readiness; a cancelled transfer must not deliver a queued insertion later.
- A same-cluster link in a child may join that group after owner authorization.
  A cross-cluster link routes to the matching owner slice, or fails with an
  actionable error when that cluster is not open.
- During a compatible tab drag (including from another window), only docks
  without visible tabs offer right/bottom edge targets; occupied docks use their
  strips. Hovered edge rails show a pointer-transparent preview at the
  destination's saved size (or an incoming utility tab's first-use size), with
  the renderer's clamp, never initializing or resizing the dock. A right
  preview reserves bottom space only when visible tabs remain in a
  non-maximized bottom dock. The hit area stays at the edge so the preview never
  intercepts other targets. Edge targets use the tab-strip move/transfer path
  and vanish when the drag leaves the window, ends, or drops.
- macOS and Windows: an unconsumed drop outside a workspace or native source
  creates a one-tab native window near the pointer at the configured floating
  size within that monitor's work area. Moving the last tab closes the empty
  native source after destination acknowledgement; failure keeps source window
  and tab. Float always moves the whole group.
- Linux drag-out is deferred for this release (use Float); reordering and moves
  between existing compatible panels remain in scope.

## Acknowledged handoffs

- `internal/appwindow/transfer_lifecycle.go` owns admission/replay rejection,
  source/target acknowledgement phases, deadline replacement, and terminal
  cleanup for group, panel-tab, and cluster-view transfers. Each protocol keeps
  a typed instance and its ID namespace (a tab opening a native window shares
  its ID with the group-opening acknowledgement on purpose). Adapters own
  preparation, authenticated callers, placement commits, and rollback under
  their existing locks; the lifecycle adds no mutex or backend dependency, and
  timeouts re-enter the adapter's failure path.
- The native index stores no copy of a window's group. A native window's
  descriptor reads the directory (the tabs placed in it, or while it opens, the
  tabs moving in), and its reports only arrange, like an app view's. Each
  pending open or dock has one native lifecycle record (state, opening source,
  timeout) that releases its directory move; the move alone records where the
  panels go, including the dock target.
- For every move: check source guards, keep the source mounted until the target
  reconstructs, and commit directory placement only after destination readiness.
- Whole-group Float and dock-back, and single panel-tab moves (drag between
  windows, tear-off, tab-menu Float/Dock), are directory-owned: the source sends
  an intent or accepts a request (no snapshot flush first), and the directory
  records a pending move on each panel without changing placement. It checks
  panel identity, not the published view, and places a dropped tab at its drop
  index. Publications cannot move, delete, or claim a moving panel, and they
  never commit a move.
- Each transfer ends in one terminal (`panelIndex.finishLocked`,
  `removePanelTabTransferLocked`, `removeClusterTransferLocked`) that releases
  its uncommitted directory move. A path that skipped it would leave the panels
  moving, and a moving panel cannot be closed. While a panel moves, close
  intents ignore it, `Open` cannot reclaim it from retention, and deleting it
  removes it from the move.
- App-view targets mount provisional copies of the moves their directory reads
  list for them; a live native target receives the tab request itself. Each
  target settles the move with `acknowledgePanelTransfer`: mounted commits,
  otherwise the source keeps the panels. An app target drops a copy when a later
  read shows the move cancelled or its source gone. Native side effects (show,
  close) precede the commit, so failure cancels the pending move with no
  rollback.
- Cluster-tab moves are directory-owned too. The source flushes its outbound
  queue (so queued close intents land first), then sends only its view state. The directory moves every docked panel of that cluster in
  the source view into the same edges of the target, after their existing tabs,
  and the insert event names those panels. The target's panel projection mounts
  them like any move; the cluster handoff, not `acknowledgePanelTransfer`,
  commits once the view is restored and those panels are mounted.
- Failure or timeout removes provisional copies and keeps source placement. A
  native source closes once its last tab commits elsewhere.
- Dock-back moves the whole same-cluster group to right or bottom, keeping order
  and active views; appending to an occupied group keeps existing tabs.
- Incoming transfers reject a renderer frozen by another transaction, even for
  a cluster with no panels; a transaction may finish its own reconstruction
  while frozen.
- Close and transfer flushes (including a move target's flush before it
  acknowledges) retry every failed close intent and the latest failed
  publication once, and reject if any still fails. A newer publication
  supersedes a failed one; a close intent stays pending until a retry lands.
  Before a renderer asks the directory to open an object, that object's queued
  close intent lands first; while it cannot, the open fails. A reopen therefore
  never finds the panel it just closed, and a late retry can never delete the
  reopened one. Other objects' failed closes do not affect the open. Retained-panel notifications coalesce while claims run; successful
  claims mount even if a later claim fails.
- Known limits: until a failed close intent lands, other views still see the
  panel. A dock-back whose directory move fails to begin can leave behind the
  app window it created for the cluster.

## Refresh and runtime state

- Panel windows use a fixed-cluster provider. Visible content owns scoped
  refresh demand; hiding or minimizing releases it but keeps cached data.
- Object and view identity transfer; shared refresh data rebuilds detail, YAML,
  events, map, and logs; shells reconnect by backend session identity. Unsaved
  YAML, saves, and mutations block renderer disposal. Native geometry is
  process-local.
- Each renderer reports its own arrangement (native: its group once live; app:
  docked groups) and flushes before moving or closing. Native panels never publish through an
  originating app window. Directory revisions drive app-view reconciliation and
  retained-panel restoration.

## Close ordering

Backend surfaces:
[application lifecycle](../architecture/application-lifecycle.md#close-quit-and-shutdown).

- Close preparation checks blockers before awaiting publication.
- A cluster-tab close guards only that cluster's content (portal menus
  included) without a full-window overlay; other tabs, application menus, and
  global navigation stay usable. App-window close, Quit, and transfers guard the
  whole renderer.
- Renderer-wide guards freeze input at once (transfers until commit or
  rollback) and keep content visible; a compact corner status appears only after
  500 ms, never blanking the window, and settlement clears it and any pending
  delay.
- Publications report only a renderer's arrangement (edge, order, activation,
  view) of the panels the directory places in it; they never open, close, claim,
  or move a panel. Closing a tab is an intent (`closePanelWorkspaceObject`)
  announced by `ObjectPanelStateContext.closePanel`/`onCloseObjectPanel`, never
  by `removeOwnedPanel`, and queued with that renderer's publications; the
  directory ignores a close for a panel it has since placed elsewhere or is
  moving.
- Before the backend removes an app view's cluster membership, shared-panel sync
  pauses that cluster's directory reads and object opens, drains admitted calls,
  and flushes queued publications and close intents. A closing cluster drops out
  of later publications; other clusters keep publishing. The close-preparation
  lease keeps input guarded through the transition; duplicate or stale close
  requests must not reach the backend again.

Sequences:

- Panel tab: guard, get registry authorization, remove a non-final tab locally,
  send its close intent. A final tab stays until its window close commits.
- Panel window: guard the group, close the window, then dispose local state,
  remove shared entries, and release its runtime reference.
- Cluster tab: guard and flush local docked panels. If another app window shows
  the cluster, release only this view and keep the shared panels. For the final
  view, preflight every native panel window of the cluster, close them only after
  all approve, discard the shared collection, then remove the tab. Denial,
  timeout, or a pending transfer keeps the tab; approved renderers stay frozen
  until settlement.
- App window: guard and flush local docked panels, keep their shared
  identities, release the view. Floating panels stay open. Closing cancels the
  transfers it takes part in, and the view declines every directory move
  addressed to it (a dock-back included), so each source keeps its panels at
  once rather than at the move's timeout. The per-protocol cancellation stays
  because a request its source has not accepted yet is not in the directory.
- Quit: preflight every ready app and panel renderer; close none until all
  approve. Approved renderers stay frozen while peers decide and through
  shutdown. Unanimous approval requests application Quit instead of closing
  views. Denial, timeout, delivery failure, or a rejected handoff releases every
  original participant, including earlier approvals. A renderer ignores a late
  request for a transaction it already settled.

## Keyboard focus

- Group roots are open, nonmodal dialogs; the rest of the workspace stays
  interactive. Reset native dialog geometry in panel CSS.
- Dock resize handles are native range inputs exposing the dimension and bounds.
  Left/Right (right dock) and Up/Down (bottom dock) move the edge 16px;
  Home/End jump to min/max. The handler cancels native range behavior for all
  arrows, Home/End, and PageUp/PageDown; other-axis arrows and PageUp/PageDown
  leave the size unchanged.
- Object-panel Tab order reaches the resize control after the header controls,
  then wraps to the first tab.
- `DockablePanelProvider.focusPanel(panelId, clusterId)` owns deferred focus;
  pass the owning cluster when activating another. It waits for group membership
  and active-tab rendering, survives the initiating view unmounting, yields to a
  newer request, and is discarded on leaving its cluster; pending DOM-focus
  callbacks cancel on rerender or cleanup. `useObjectPanel` and workspace focus
  events delegate to it and must not wait for registration inside content the
  panel replaces.

## Validation

- Trace complete object identity from the initiating link or action through the
  directory. Prove the source stays live until target
  acknowledgement and unchanged on failure or timeout, and that panel visibility
  controls only its scoped demand. Add reducer/protocol and visible component
  tests. Prove transfer contracts on the real `WorkspaceDirectory` and
  registry; seed panels with `Open` (`seedPanels`, `seedNativeGroup` in
  `internal/appwindow/registry_test.go`), since publications cannot create
  them.
- Exercise clean, unsaved-YAML, saving, and mutation-in-flight guards across
  move, tab close, titlebar close, cluster close, app-window close, and quit;
  cover both docks, Float, dock-back, group order, active tabs, uniqueness,
  focus, and that cluster switching never rewrites cluster identity or app-view
  membership. Run typecheck and the dockable, object-panel, shortcut, and
  appwindow suites.
- macOS and Windows native checks: cluster and panel tab moves with one and
  several tabs into new and existing windows; occupied and empty docks (preview
  matches final placement, clears after drop or cancel); cross-cluster
  rejection incl. empty docks; identity, active view, phantom animation,
  empty-source closure; failed or cancelled transfers keep the source; closing
  a dock-back's target app window returns the native window at once. Linux:
  drag-out deferred; test reorder, moves between existing panels, Float,
  dock-back.
- One cluster in two app windows: find/focus shared panels from either; closing
  one cluster tab keeps them, closing the final one closes them after all guards
  approve. Close the last app window and dock a surviving floating panel into a
  new app view.
- Quit with different clusters in two app windows plus panels: an unsaved draft
  blocks quit and leaves the other renderer usable; after a clean quit, restart
  restores both selections.
- Require an actual destination drop; drag-over or an insertion indicator does
  not prove transfer. If automation only hovers, drop manually and inspect
  content retention and empty-source closure.
- Known gap: PR #361 checks (2026-09-21) did not establish native reorder or
  drops between occupied docks, into empty docks, or between windows
  (automation hit `noWindowsAvailable` or left placement unchanged; cause
  unknown); Windows/Linux UI checks were not run. Record revision and platform
  when resolved.
