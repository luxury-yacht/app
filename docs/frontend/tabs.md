# Tabs Contract

Every tab strip uses the shared `Tabs` base component. Drag-capable tab strips
also use the shared drag coordinator.

## Agent Contract

- Use `frontend/src/shared/components/tabs/Tabs.tsx` for tab rendering.
- Do not create feature-local tab components for standard tab behavior.
- Tab selection is controlled by the consumer; the base component does not own
  active state.
- Shared tab styles live in `frontend/styles/components/tabs.css`.
- Drag-capable consumers use the shared drag coordinator provider/hooks.
- Do not mount a second drag provider.
- Keep tab ids stable; they may be persisted, used as React keys, and used for
  drag/drop identity.

## Consumers

| Consumer | Wrapper | Drag |
| --- | --- | --- |
| Object Panel | `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelTabs.tsx` | no |
| Diagnostics | `frontend/src/core/refresh/components/DiagnosticsPanel.tsx` | no |
| Cluster tabs | `frontend/src/ui/layout/ClusterTabs.tsx` | reorder and cross-window moves |
| Dockable tabs | `frontend/src/ui/dockable/DockableTabBar.tsx` | reorder and cross-strip moves |

## Base Tab Rules

- Provide an accessible `aria-label` for every tab strip.
- Use stable tab ids and clear labels.
- Use close callbacks only when the consumer owns close lifecycle.
- Keep keyboard navigation on the WAI-ARIA manual activation pattern.
- Arrows move the roving focus stop without activating a tab. Tab then reaches
  that tab's existing Close button. Focus reveals the Close control.
- The Close button is a sibling of the element with `role="tab"`, inside a
  shared visual shell. This keeps their names and roles separate in accessibility
  trees. Consumers that enumerate tab controls use the shell as their boundary;
  the tab element retains its drag markers, geometry and roving focus.
- ClusterTabs and DockableTabBar retain their right-click context menus, which
  offer Move tab left/right through the existing order owner, with end positions disabled.
  Ordering a tab does not activate it. The synthetic Global tab is not reordered.
- If a focused tab control disappears, focus an available remaining tab. Close
  a menu whose owning tab disappears instead of reviving it on reopen.
- Use shared overflow behavior instead of custom scroll controls.
- Do not override reserved ARIA, focus, or keyboard props through escape-hatch
  props.

## Drag Rules

- `DockablePanelProvider` mounts one `TabDragProvider` per native document so
  dockable and cluster tabs in that document share one coordinator. Consumers
  must not add a nested provider around it.
- Drag payloads must identify the source kind and stable tab id. Dockable
  cross-window payloads also carry source window/group,
  cluster, complete object identity, and active view.
- Cross-document dragover uses kind and cluster MIME markers because
  protected HTML drag data exposes types but not payload values. Only compatible
  panel groups show a drop indicator; cluster tabs accept local reorders and
  cross-window moves carrying stable cluster ID, selection, and source window.
  The destination validates the complete payload again at drop time. MIME
  markers control the preview, not native transfer authorization.
- On macOS, the shared native drag callback suppresses AppKit's failed-drop
  return animation for both cluster-tab and dockable-tab MIME markers, whether
  exposed as pasteboard types or wrapped in WebKit custom data. An outside drop
  uses `dropEffect: none` to trigger tear-off, so its phantom tab must not return
  to the source strip. Keep native policy tests aligned with both tab kinds.
- A cluster's last tab can move to an existing or new app window. Close the
  source app window only after the destination acknowledges reconstruction and
  the backend commits the transfer, and only if the source's
  authoritative cluster tab set is empty. A failed or cancelled transfer keeps
  the source open. The synthetic Global tab does not keep an empty source open.
  Release the transfer lock before native closure because close hooks can run
  synchronously. The context-menu move follows the same transfer lifecycle.
- Cluster tear-offs carry an optional screen-space drop point through the native
  request. Presence distinguishes a drag at `(0, 0)` from a menu action without a
  drop point. Reuse panel placement to choose the pointer's monitor, constrain
  the window to its work area, and position the title bar near the pointer.
  A dragged app window opens unmaximised; a menu-created window keeps the usual
  source-window cascade behavior.
- Reorder, cross-strip move, and empty-space drop behavior belongs in the
  consumer wrapper, not the base `Tabs` component.
- Dockable tab movement must preserve panel identity, group membership, active
  tab state, and cluster/object identity. Local drops apply immediately;
  cross-window drops use the acknowledged native-panel transfer transaction.
- Drag-out to create a new native panel window is in scope on macOS and Windows.
  Linux drag-out is deferred for this release; see
  [dockable-panels.md](dockable-panels.md) for the platform validation checklist.

## Global Workspace Tab

The cluster strip prepends a synthetic `__global__` tab only while more than
one cluster is open. It uses the shared `Tabs` renderer but is not part of
persisted cluster ordering, close behavior, or drag payloads. DOM drop indices
must be translated past this synthetic tab before updating cluster order.

When Global is active, no cluster tab is selected. Clicking a cluster tab exits
Global before changing the foreground kubeconfig; clicking Global preserves the
foreground kubeconfig and restores the last Global view. See
[navigation.md](navigation.md).

## Change Checklist

When changing tabs:

1. Decide whether the behavior belongs in the base component, drag coordinator,
   or one consumer wrapper.
2. Check keyboard, close, overflow, drag, and accessibility behavior.
3. Preserve tab ids and persisted ordering.
4. Update object-panel, diagnostics, cluster, and dockable tests if shared
   behavior changes.

## Validation

Run targeted tab/consumer Vitest tests and typecheck. For drag/drop changes,
verify manually in the app.

## Shared cluster tabs across app windows

A cluster tab represents one app window’s view of a shared cluster workspace.
The same cluster can appear in multiple app windows. Its context menu contains
three actions with the shared menu icon styling, no heading, and a separator
before Close, matching object-panel tab menus:

- **Open in new window** adds another app view of that cluster while keeping the
  source tab and shared panel placements. The target is seeded before rendering.
- **Move to new window** transfers the tab through the acknowledged lifecycle
  below; the source remains until the destination has accepted the view.
- **Close** uses the same cluster-close transition as the clicked tab’s close
  button, including when the clicked tab is inactive.

A cross-window cluster move carries the source view’s navigation, namespace,
filters, and docked panels. Reuse an existing destination tab and preserve its
navigation; append the incoming docked panels. Floating panel windows stay in
place. Do not remove the source view until exact destination reconstruction has
been published and acknowledged. The runtime retains both participant views
until that commit, so movement does not disconnect the cluster.
