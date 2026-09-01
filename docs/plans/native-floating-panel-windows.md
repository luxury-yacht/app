# Native floating panel windows

Status: proposed implementation plan; product decisions accepted and review
corrections incorporated on 2026-08-31.

## Outcome

Replace the in-page HTML implementation of the `floating` panel placement with
ordinary, resizable Wails windows. Each native panel window represents one
floating tab group, is immutably owned by one workspace window, and is scoped to
one cluster. Closing the owner workspace or its cluster tab closes the owned
panel windows after close guards allow the operation.

The first shipped content type is the object panel. The window and handoff
protocol must be generic enough to add other panel types without teaching the
native registry about React components.

## Current constraints

- The native registry currently treats every tracked window as a peer workspace:
  runtime-ready calls workspace initialization, a non-last close releases a
  workspace, and the last close prepares application quit
  (`internal/appwindow/registry.go:73-79`, `internal/appwindow/registry.go:118-148`).
  A panel window therefore cannot be added to the existing lifecycle slice
  without first introducing explicit window roles.
- Every webview currently initializes window identity and auto-refresh and then
  mounts the full `App` tree (`frontend/src/main.ts:26-49`). The `App` tree mounts
  the full Kubernetes/workspace provider hierarchy
  (`frontend/src/App.tsx:216-239`). A panel window needs a separate bootstrap and
  must not acquire workspace or cluster-tab ownership.
- Object-panel state and dockable layout are currently React-memory state scoped
  by the selected cluster (`frontend/src/modules/object-panel/contexts/ObjectPanelStateContext.tsx:143-207`,
  `frontend/src/ui/dockable/DockablePanelProvider.tsx:251-325`). A new webview
  cannot receive the live React tree.
- A panel registration contains callbacks and React refs
  (`frontend/src/ui/dockable/tabGroupTypes.ts:11-28`), and grouped content is
  rendered through live content refs
  (`frontend/src/ui/dockable/DockablePanelProvider.tsx:98-104`). Cross-window
  movement therefore needs a separate serializable snapshot contract.
- The canonical object-panel reference already carries cluster-complete object
  identity and produces a stable owner-local panel ID
  (`frontend/src/modules/object-panel/objectPanelRef.ts:20-25`,
  `frontend/src/modules/object-panel/objectPanelRef.ts:132-149`). That contract is
  the identity payload for object tabs.
- The pinned Wails window options expose an ordinary top-level window but no
  cross-platform parent option (`go.mod:15` and
  `$GOMODCACHE/github.com/wailsapp/wails/v3@v3.0.0-beta.16/pkg/application/webview_window_options.go:80-180`).
  `AttachModal` exists on the window interface
  (`$GOMODCACHE/github.com/wailsapp/wails/v3@v3.0.0-beta.16/pkg/application/window.go:9-97`),
  but modal behavior is not the requested independent, resizable panel
  behavior. Ownership will therefore be an application lifecycle contract, not
  an OS-modal relationship.

## Accepted product contract

1. One native window represents one floating tab group.
2. The owner workspace is immutable for the lifetime of a panel window.
3. Every panel window has exactly one `clusterId`; tabs from different clusters
   cannot share it.
4. Closing the owner workspace closes all of its panel windows. Closing the
   owning cluster tab closes that cluster's panel windows.
5. Switching the owner's active cluster tab does not close, hide, retarget, or
   reparent a native panel. The child stays fixed to its original `clusterId`
   and manages demand for its own visible panel content.
6. Closing a panel window does not close or release its owner workspace.
7. Explicit controls float and dock panels. Cross-window tab dragging and
   cross-workspace reparenting are deferred.
8. Same-cluster links opened inside a panel window add or focus a tab in that
   same native tab group. A cross-cluster link is routed back to the owner and
   never enters a group with a different `clusterId`.
9. An object may be open only once within one owner workspace, including its
   docked and native groups. A different owner workspace may open the same
   object independently.
10. Panel windows are ordinary resizable application windows. They are not
   globally always-on-top. Their focus, minimize, and restore state is
   independent of the owner.
11. Panel windows and their geometry are not restored after application
    relaunch in the first release.
12. Cached/read-only data is reconstructed by identity and refetched. Shells
    reconnect through their backend session identity. Unsaved YAML drafts and
    in-flight mutations block float, dock, tab close, panel-window close,
    cluster-tab close, and owner-window close.
13. `Cmd/Ctrl+W` closes the active tab in a panel window; closing its last tab
    closes the panel window. The native titlebar close closes the entire group,
    subject to the same guards. Existing Escape editor/modal layering remains
    unchanged.
14. A move is an acknowledged handoff. The source remains live until the target
    has reconstructed the group and acknowledged readiness. A failed or stale
    handoff leaves the source unchanged.

## Target ownership model

### Native roles

Make the native registry role-aware rather than maintaining a second window
registry:

```text
NativeWindowRole
├── workspace { windowName }
└── panel {
      windowName,
      ownerWindowName,
      clusterId,
      groupId
    }
```

The existing workspace lifecycle remains workspace-only. Panel roles never call
`WindowRuntimeReady`, `ReleaseWorkspaceWindow`, or
`PrepareQuitFromWindow`. Workspace count, most-recent workspace focus, geometry
persistence, cluster leases, and last-workspace quit decisions ignore panel
roles.

The registry keeps these indexes for the current process only:

- workspace name -> owned panel window names;
- panel window name -> immutable owner/cluster/group role;
- transfer ID -> pending open/dock/close transaction;
- panel window name -> native window handle and readiness/close state.

The registry does not own object data, active sub-tabs, YAML drafts, or React
registrations.

### Frontend authority

Each workspace webview owns one `OwnedPanelDirectory`, partitioned into
`clusterId` slices, for all of its object panels, including panels rendered in
child windows. Replace the current implicit `openPanels` meaning with an
explicit per-cluster location:

```text
OwnedPanelDirectory = Record<clusterId, {
  panels: Map<panelId, OwnedObjectPanel>
}>

OwnedObjectPanel {
  panelId,
  objectRef,
  activeView,
  location:
    | { kind: "docked", edge: "right" | "bottom" }
    | { kind: "panel-window", windowName, groupId }
}
```

This makes owner-local uniqueness enforceable even after the source React
component has moved out of the workspace webview. The child panel window holds a
rendering projection of one group and sends state changes to its owner; it does
not become a second authority.

The selected cluster chooses only which directory slice the workspace renders
as docked content. Native children continue rendering their own immutable
slice. Cluster-tab close enumerates and guards the matching slice before it
removes either the directory entries or the backend tab ownership.

The process-level native registry routes messages and owns handoff status. It
must not become a persistence store for frontend panel state.

### Cluster switching and refresh demand

An open inactive cluster remains owned by the workspace's complete cluster-tab
set; active selection is only foreground priority
(`docs/architecture/multi-cluster.md:98-114`). A panel child does not register a
second workspace or cluster-tab owner. It receives a read-only fixed-cluster
projection from its bootstrap descriptor.

Owner cluster switches have no lifecycle effect on the child. Instead, the
child's mounted active content acquires the normal cluster-and-scope leases for
its own `clusterId`. This is visible consumer demand, not passive background-tab
demand: the freshness contract retains inactive cluster data without expensive
producer demand, while displayed cross-cluster consumers acquire explicit
leases (`docs/architecture/data-freshness.md:22-25`,
`docs/architecture/data-freshness.md:51-70`).

Minimizing or hiding the child releases its panel-scoped visible demand while
preserving retained data. Restoring it paints retained data first and reacquires
the scopes with foreground intent. Closing the owning cluster tab still wins:
after guards pass, it closes the children and releases their leases before the
owner removes the backend cluster-tab ownership.

### Serializable content contract

Add a discriminated snapshot contract whose first variant is object-panel:

```text
PanelGroupSnapshot {
  schemaVersion,
  transferId,
  ownerWindowName,
  clusterId,
  groupId,
  tabs: PanelTabSnapshot[],
  activePanelId
}

PanelTabSnapshot = {
  kind: "object",
  panelId,
  objectRef: {
    clusterId, group, version, kind, namespace, name, ...display metadata
  },
  activeView
}
```

`objectRef.clusterId` must equal the group `clusterId`; every object reference
must contain `clusterId`, `group`, `version`, `kind`, `namespace`, and `name`.
The backend validates the invariant before creating or routing a window. React
nodes, callbacks, refs, fetched payloads, credentials, YAML draft text, and
terminal buffers never enter the snapshot.

Do not encode owner, cluster, object, role, or transfer identity in a query
string. Workspace and panel windows both load the existing `/` entry URL. The
child reads its Wails window name, requests its bootstrap descriptor from the
native command boundary, and chooses the panel root from that descriptor. The
descriptor is the only source of window-role truth; `/panel` is not introduced.

### Composition and dependency direction

- `internal/appwindow.Registry` owns Wails window instances, role indexes,
  owner-child close ordering, and pending handoffs.
- `backend.DesktopShell` remains the concrete owner of native Wails access and
  exposes the panel-window commands through constructor-supplied callbacks, as
  the workspace creation callback is supplied today
  (`backend/desktop_shell.go:45-60`, `backend/app.go:42-84`, `main.go:112-123`).
- `backend.DesktopService` delegates the new command surface to its declared
  owner and remains the sole Wails service
  (`backend/desktop_service.go:142-175`, `backend/desktop_service.go:562-576`).
- `main.go` wires callbacks that close over the registry pointer, preserving the
  current construction order without late mutation or a package cycle.
- Frontend backend calls stay behind `frontend/src/core/backend-api`; native
  window calls and targeted event listening stay behind
  `frontend/src/core/desktop-runtime`.

This direction avoids a cycle: the registry consumes narrow lifecycle and
handoff callbacks, the backend never imports the registry, and `main.go` is the
only package that knows both concrete sides.

## Handoff and lifecycle ordering

### Float a group

1. The owner evaluates every tab's transfer guard. A blocked guard leaves the
   group unchanged and focuses the blocking tab.
2. The owner creates a complete `PanelGroupSnapshot` and calls
   `BeginPanelWindowOpen` with its own window identity.
3. The registry checks that the self-reported owner name resolves to a live
   workspace role, that the source/owner/transfer records are consistent, and
   that group/cluster/object identity is valid. This is consistency validation,
   not caller authentication. It then records a pending transfer and creates a
   hidden panel window.
4. Wails runtime-ready only marks the webview capable of bootstrapping. It does
   not commit the transfer or run workspace initialization.
5. The child reads its descriptor, mounts the panel-window provider tree,
   reconstructs the complete group, and calls `AcknowledgePanelWindowReady` with
   the transfer ID.
6. The registry atomically marks the child live, shows it, and emits a targeted
   acknowledgement to the owner.
7. Only after that acknowledgement does the owner change the directory location
   to `panel-window` and unmount the docked/HTML source rendering.
8. Creation failure, reconstruction failure, a stale acknowledgement, or child
   close before acknowledgement closes the incomplete child and preserves the
   source group exactly.

### Dock a native group

1. The child evaluates transfer guards and requests `right` or `bottom`.
2. The registry routes the current serialized group snapshot to the immutable
   owner and records a pending dock transfer.
3. The owner verifies the transfer ID, owner, cluster, and unique object
   locations, renders the docked target, and acknowledges target readiness.
4. The child remains mounted until it receives the commit acknowledgement.
5. The registry then closes the child window and removes its role. Failure or a
   stale acknowledgement leaves the child window live and the owner directory
   unchanged.

Docking a whole native group preserves tab order and active tab. Docking one tab
out of a native group is a later enhancement; the first release's right/bottom
controls move the group.

### Open and focus object links

The owner directory is the arbiter for owner-local uniqueness:

- If the object is already docked, focus the owner and existing docked tab.
- If it is already in a panel window, focus that window and tab.
- If it is new and the request originated in a panel window, authorize the child
  to add it to that same group and then record the new location.
- If it is new and the request originated in the workspace, use the workspace's
  preferred docked/native target exactly once.
- If the requested object's `clusterId` differs from the child group's
  `clusterId`, do not add it to the child. Route it to its owner-cluster slice:
  focus/open it there when that cluster tab is owned, or reject it with an
  actionable message when the owner has not opened that cluster.

Child-originated requests are routed to the owner and acknowledged before the
child commits the new tab. This prevents simultaneous opens in two webviews from
creating duplicates.

### Native menu and shortcut routing

Menu events target the focused window (`backend/menu.go:118-124`), and the
frontend runtime filters events by sender identity
(`frontend/src/core/desktop-runtime/index.ts:24-33`). A focused child therefore
needs a role-specific shortcut/event surface; it must not mount the existing
workspace `GlobalShortcuts` unchanged because that surface maps `menu:close` to
cluster-tab/window close (`frontend/src/ui/shortcuts/components/GlobalShortcuts.tsx:120-128`,
`frontend/src/ui/shortcuts/components/GlobalShortcuts.tsx:309-318`).

Use a `PanelWindowShortcuts` surface, sharing lower-level keyboard primitives
with the workspace surface:

- `menu:close` closes the active child tab through the panel guard protocol;
- cut, copy, paste, select-all, and zoom events operate locally through the
  existing keyboard/zoom providers;
- workspace-only commands such as Open Cluster, Settings, About, Command
  Palette, sidebar, diagnostics, object diff, and Application Logs focus the
  owner and route the command to it;
- unsupported developer/debug projections are explicitly audited and handled or
  ignored by role rather than accidentally reaching missing workspace contexts.

Rename the native menu item from `Close Cluster` to the context-neutral `Close`
while retaining `Cmd/Ctrl+W`; the focused frontend role decides what closes.

### Close ordering

| Trigger | Required order |
| --- | --- |
| Panel `Cmd/Ctrl+W` | Guard active tab -> owner removes directory entry and acknowledges -> child releases leases and clears its webview-local tab caches -> child unmounts tab -> close native window if group is empty. |
| Panel titlebar close | Cancel initial native close -> guard every tab -> owner acknowledges group removal -> child releases leases and clears its webview-local caches -> close native panel. If blocked, keep/focus the panel. |
| Workspace cluster-tab close | Guard every owned panel for `(owner, clusterId)` -> close/ack those panel windows -> execute the existing cluster-tab close and ownership release. No-panel and all-allowed paths must remain permitted. |
| Non-last workspace close | Cancel initial native close -> guard all owned panels -> close/ack children -> release the workspace selection -> close owner. |
| Last workspace/application quit | Guard all owned panels first -> perform existing quit preparation -> close children -> close owner/application. A rejected guard cancels the quit and restores the lifecycle state. |
| Child crash/forced native disappearance | Registry removes only the panel role and notifies the owner to return or close the affected entries; it never releases a workspace. |

Native close hooks are synchronous, while the guard protocol crosses webviews.
The first close event must therefore be canceled and converted into an explicit
asynchronous close transaction. A second registry-authorized close bypasses the
preflight. Timeouts fail closed, leave source state intact, and surface a
recoverable error instead of silently discarding edits.

## Runtime state policy

| State | Float/dock behavior |
| --- | --- |
| Object identity, active object sub-tab, group order | Serialize and reconstruct. |
| Detail/YAML/events/map/log snapshots | Do not transfer; reconstruct scopes from full identity and refetch/subscription-read from the process refresh system. |
| Log viewer preferences and scroll state | Do not transfer in the first release. The cache is module-local to one webview (`frontend/src/modules/object-panel/components/ObjectPanel/Logs/logViewerPrefsCache.ts:36-50`, `frontend/src/modules/object-panel/components/ObjectPanel/Logs/logViewerPrefsCache.ts:69-81`), so float/dock starts with target defaults. Actual tab close must clear the entry in the webview that rendered that tab; an owner-side eviction cannot clear a child's module cache. |
| Shell session | Transfer backend session ID and reconnect/replay through the existing session APIs; do not transfer xterm/DOM buffers. `ShellTab` already separates backend session identity from terminal refs (`frontend/src/modules/object-panel/components/ObjectPanel/Shell/ShellTab.tsx:75-110`). |
| YAML edit with changed draft | Block transfer/close until save or cancel. |
| YAML save or another mutation in flight | Block transfer/close until completion. |
| Modal, menu, focus, scroll, hover, transient loading | Recreate or reset. |
| Native geometry | Use the current HTML floating geometry only for initial native placement; thereafter the OS window owns it for the process lifetime. Do not persist it for relaunch. |

Expose a local `PanelLifecycleGuard` registry at the panel boundary. YAML and
mutation owners publish typed reasons such as `unsaved-yaml` and
`mutation-in-flight`; window, tab, cluster, and workspace close paths consume the
same guard result. Do not infer safety from DOM presence or duplicate ad hoc
checks in each close button.

## Phased red/green/refactor plan

Every behavior phase starts with the named failing tests, runs them to confirm
the intended failure, implements the minimum contract, and refactors only while
green.

Phases 3 through 5 are one merge and release unit. They may be developed under
tests in sequence, but production Float/Undock remains on the current renderer
until native open, dock-back, uniqueness, guards, and close cascades are all
green. The final cutover wires the native path and removes the HTML path in the
same change; no build exposes both implementations as user-selectable modes.

### Phase 1: Pure roles and transfer state machine

Red tests:

- Add `internal/appwindow/panel_transfer_test.go` for valid role construction,
  complete identity, owner/cluster invariants, duplicate group rejection, stale
  transfer IDs, and the allowed state transitions.
- Extend `internal/appwindow/registry_test.go` to prove panel windows are excluded
  from workspace count/most-recent state and cannot trigger workspace release or
  application quit.

Green implementation:

- Split the current workspace-only lifecycle bookkeeping from a role-aware
  registry index.
- Add pure transfer records and validation before any new Wails command.
- Add panel-specific window options with the same `/` entry URL, ordinary frame,
  resizable, `AlwaysOnTop: false`, and no workspace geometry restore. Role is
  resolved only from the bootstrap descriptor.

Regression focus: existing peer names, cascade geometry, startup visibility,
last-workspace behavior, and second-instance focus remain workspace-only.

### Phase 2: Transport boundary and bootstrap selection

Red tests:

- Extend `backend/desktop_service_ownership_contract_test.go` to require every
  panel command to delegate to its declared owner.
- Add DesktopShell tests for unavailable registry callbacks, invalid callers,
  targeted window events, and errors from missing/stale panel windows.
- Add frontend bootstrap tests proving a workspace descriptor mounts the existing
  app and a panel descriptor mounts only the panel root.
- Prove the panel root consumes a fixed `clusterId` without calling workspace
  selection mutation or registering a second cluster-tab owner.
- Prove role-specific menu routing: child close/edit/zoom stay local,
  workspace-only commands target the owner, and no child handler requires
  workspace-only contexts.
- Add API-boundary tests proving generated bindings are imported only through
  `frontend/src/core/backend-api`.

Green implementation:

- Add the versioned snapshot/descriptor DTOs and registered typed events.
- Add the DesktopService command delegates and regenerate Wails bindings.
- Add `frontend/src/core/panel-windows` as the protocol/client boundary.
- Change `frontend/src/main.ts` to initialize identity, read a discriminated
  window descriptor, and lazy-load `WorkspaceApp` or `PanelWindowApp`.
- Split workspace and panel shortcut/event surfaces over shared keyboard
  primitives, and rename the native `Cmd/Ctrl+W` menu label to `Close`.
- Keep error reporting, preferences, zoom, keyboard infrastructure, and required
  refresh clients in both roots, but keep workspace selection mutation,
  sidebar/navigation, favorites, and background workspace refresh out of the
  panel root.

Readiness tests must prove both sides of the gate: a panel cannot acknowledge
before its group is mounted, and bootstrap reads needed to reach mounted state
remain allowed while the transfer is pending.

### Phase 3: Shared group renderer and native float handoff

Red tests:

- Add focused component tests for a shared group surface preserving tab order,
  active tab, object context, close callbacks, and keyboard focus in workspace
  and panel-window modes.
- Add owner-directory reducer tests for `docked -> pending-window -> panel-window`
  and rollback from every failure point, with independent `clusterId` slices.
- Add an integration test proving the owner source stays mounted until the child
  acknowledgement and is removed exactly once afterward.
- Add cluster-switch tests proving docked rendering selects the new slice while
  existing native children retain their original cluster, active group, and
  leases without acquiring workspace ownership.
- Add visibility tests proving minimize/hide releases only the child's scoped
  demand, retained data survives, and restore reacquires those scopes with
  foreground intent.

Green implementation:

- Extract shared tab-group chrome/body rendering from the current group-leader
  path so docked workspace groups and native panel roots use one renderer.
- Introduce the owner directory and a child projection; do not attempt to
  serialize `PanelRegistration`.
- Implement the native open/handoff path behind integration tests. Do not change
  the production Float/Undock action until Phase 5 completes the release unit.

### Phase 4: Dock back, links, and owner-local uniqueness

Red tests:

- Prove dock-right and dock-bottom preserve group order, active tab, active
  object sub-tabs, and source survival until owner acknowledgement.
- Prove stale/failing dock acknowledgements leave the native child unchanged.
- Prove object links from a child add to that child group, focus an existing
  docked/native location, and never duplicate an object within one owner.
- Prove a cross-cluster child link is routed to the matching owner slice or
  rejected when that cluster is not open; it never joins the child group.
- Prove the same complete object identity may exist under two different owner
  workspaces.

Green implementation:

- Add explicit dock controls to the panel-window group shell.
- Route child open/focus requests through the owner directory.
- Add targeted focus/activate messages for owner and child locations.
- Preserve ordinary in-window tab reorder; reject cross-window drag payloads.

### Phase 5: Shared guards and close cascade

Red tests:

- Add guard-registry tests for clean, unsaved YAML, saving, and mutation-in-flight
  states, including deterministic focus of the first blocker.
- Add YAML transaction tests proving a changed draft blocks while an unchanged
  edit does not; the transaction already exposes `isEditing`, `draftYaml`, and
  `isSaving` (`frontend/src/modules/object-panel/components/ObjectPanel/Yaml/YamlTab.tsx:635-667`).
- Add registry tests for panel titlebar close, cluster close, non-last owner close,
  last-owner quit, cancellation, authorized second close, child crash, and no
  workspace release from a panel close.
- Preserve the workspace close cases in
  `frontend/src/ui/shortcuts/components/GlobalShortcuts.test.tsx` and add
  `PanelWindowShortcuts` tests for active-tab and last-tab `Cmd/Ctrl+W`; the
  workspace path currently maps `menu:close` to cluster-tab/window close
  (`frontend/src/ui/shortcuts/components/GlobalShortcuts.tsx:309-318`).

Green implementation:

- Register YAML and mutation guards at one panel lifecycle boundary.
- Add asynchronous native-close preflight and registry-authorized commit.
- Route owner and cluster close through the same guard coordinator before their
  existing release paths.
- Implement active-tab close, last-tab window close, group titlebar close, and
  blocker focus/notification.
- Wire production Float/Undock to `BeginPanelWindowOpen`, remove the in-page
  `floating` renderer, and make `floating` a product action targeting a native
  window. Remove the HTML path in the same release unit rather than retaining a
  runtime compatibility mode.

Regression tests must prove the operation that reaches the allowed state remains
available: canceling the YAML edit, completing the mutation, or saving the draft
must unblock the same pending close/move without reopening the panel.

### Phase 6: Platform behavior, cleanup, and durable documentation

- Exercise one owner with multiple native groups and multiple workspace owners
  on macOS, Windows, and Linux.
- Switch the owner among open cluster tabs while a child stays visible; verify
  the child remains fixed to its cluster, its visible scopes continue to receive
  data, the owner switch does not acquire/release child workspace ownership, and
  minimize/restore releases then reacquires only the child's scoped leases.
- Verify focus, independent minimize/restore, resize/min-size, multi-monitor
  initial placement, native titlebar close, owner close cascade, application
  quit, and no relaunch restore.
- Verify shell reconnect, object refetch, logs/events/map refresh, auth failure
  overlays, deleted objects, and an unresponsive child close timeout.
- Remove residual HTML floating drag/resize/maximize code, CSS, tests, and any
  settings text that still describes viewport-relative floating geometry.
- Keep cross-window drag, reparenting, relaunch restore, and non-object panel
  renderers explicitly out of scope.
- Move final lifecycle contracts into
  `docs/architecture/application-lifecycle.md`, rendering/state contracts into
  `docs/frontend/dockable-panels.md`, and key behavior into
  `docs/frontend/keyboard.md`. Delete this plan after all durable guidance is in
  place.

## Validation gates

During each phase:

```sh
mise exec -- go test ./internal/appwindow ./backend -run 'PanelWindow|Registry|DesktopService'
npm --prefix frontend run test -- <focused test files>
mise exec -- wails3 task test:backend-coverage
mise exec -- wails3 task test:frontend-coverage
```

Before reporting implementation complete:

```sh
GOCACHE=/tmp/luxury-yacht-go-build STATICCHECK_CACHE=/tmp/luxury-yacht-staticcheck \
  mise exec -- wails3 task qc:prerelease
git status --short
git diff --check
```

The full prerelease gate requires escalated sandbox permission because backend
and race suites open localhost test listeners. Report directly affected backend
and frontend statement coverage; target at least 80%, or report the measured gap
before claiming completion.

## Completion criteria

- No in-page HTML floating panel remains.
- A native panel is never counted or initialized as a workspace peer.
- Owner and cluster identity are immutable and validated at every command.
- Source and target cannot both commit a successful handoff, and neither can be
  lost on a failed handoff.
- All close paths use one guard protocol and preserve unsaved/in-flight work.
- Object identity remains complete and unique per owner across docked and native
  locations.
- Owner cluster switches leave child identity unchanged, and child visibility
  alone controls its panel-scoped refresh demand.
- Existing dock-right, dock-bottom, workspace close, cluster close, application
  quit, menu, refresh, and shell behavior pass their regression suites.
- Durable docs replace this temporary plan.
