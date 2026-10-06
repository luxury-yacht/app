# Tabs Contract

Every tab strip renders through `frontend/src/shared/components/tabs/Tabs.tsx`
(styles: `frontend/styles/components/tabs.css`); drag-capable strips also use
the shared drag coordinator. No feature-local tab components for standard
behavior. Reorder, cross-strip move, and empty-space drop logic belongs in the
consumer wrapper, not `Tabs`.

| Consumer | Wrapper | Drag |
| --- | --- | --- |
| Object Panel | `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelTabs.tsx` | no |
| Diagnostics | `frontend/src/core/refresh/components/DiagnosticsPanel.tsx` | no |
| Cluster tabs | `frontend/src/ui/layout/ClusterTabs.tsx` | reorder and cross-window moves |
| Dockable tabs | `frontend/src/ui/dockable/DockableTabBar.tsx` | reorder and cross-strip moves |

## Base tab rules

- The consumer controls selection; `Tabs` owns no active state. Pass close
  callbacks only when the consumer owns the close lifecycle.
- Keep tab ids stable: they may be persisted, used as React keys, and used as
  drag/drop identity.
- Every strip has an accessible `aria-label`. Keyboard follows WAI-ARIA manual
  activation: arrows move the roving focus stop without activating; Tab then
  reaches that tab's Close button. Hover or keyboard focus reveals Close; a
  mouse open or focus does not keep it revealed after the pointer leaves.
- Close is a sibling of the `role="tab"` element inside a shared visual shell,
  keeping names and roles separate in accessibility trees. Consumers enumerating
  tab controls use the shell as boundary; the tab element keeps drag markers,
  geometry, and roving focus.
- The labelled `role="tablist"` owns only tab selectors via `aria-owns`
  ([ARIA ownership](https://www.w3.org/TR/wai-aria-1.2/#aria-owns)) because the
  visual DOM interleaves tabs with Close buttons for layout and focus order;
  Close and overflow buttons stay outside. `Tabs` assigns per-strip unique DOM
  IDs kept across reorder; the ownership list follows current order and drops
  removed tabs. `.tab-strip` remains the visual, scroll, and drag boundary: from
  the tablist, find the closest `.tab-strip`, then query its tabs.
- ClusterTabs and DockableTabBar context menus end with Move tab left/right
  (directional icons), omitting unavailable directions and empty reorder
  sections. Reordering never activates a tab.
- If a focused tab control disappears, focus a remaining tab. Close a menu whose
  tab disappears instead of reviving it on reopen.
- Use shared overflow, not custom scroll controls. Never override reserved ARIA,
  focus, or keyboard props through escape-hatch props.

## Drag rules

- `DockablePanelProvider` mounts one `TabDragProvider` per native document,
  shared by dockable and cluster tabs; never nest another.
- Payloads carry source kind and stable tab id; dockable cross-window payloads
  add source window/group, cluster, complete object identity, and active view.
- Cross-document dragover reads kind and cluster MIME markers, since protected
  HTML drag data exposes types but not values. Only compatible panel groups show
  a drop indicator; rejected cluster combinations show none. Cluster tabs accept
  local reorders and cross-window moves carrying stable cluster ID, selection,
  and source window. Markers drive only the preview: the destination
  revalidates the full payload at drop and the backend authorizes the transfer.
- Document-level drag observers keep a drop destination mounted until its own
  drop handler consumes the event; defer cleanup until dispatch finishes, since
  React can flush between capture and target listeners.
- macOS: the shared native drag callback suppresses AppKit's failed-drop return
  animation for cluster-tab and dockable-tab markers (pasteboard types or WebKit
  custom data), because an outside-drop tear-off reports `dropEffect: none`.
  Keep native policy tests aligned with both kinds.
- Dockable tabs: dragging within a strip reorders one tab; between compatible
  strips it moves one tab (workspace to native, native to workspace, or native
  to native; same cluster only); cross-cluster drops are rejected. Moves keep panel identity, group
  membership, active tab, and object identity. Local drops apply immediately;
  cross-window drops use the
  [acknowledged transfer](dockable-panels.md#acknowledged-handoffs), which also
  owns dock edge targets and drag-out tear-off (deferred on Linux).
- Cluster tear-offs pass an optional screen-space drop point through the native
  request; its presence distinguishes a drag at `(0, 0)` from a menu action.
  Reuse panel placement to pick the pointer's monitor, constrain to its work
  area, and put the title bar near the pointer. Dragged app windows open
  unmaximized; menu-created windows keep the source-window cascade.

## Global workspace tab

Global behavior is owned by [navigation.md](navigation.md). The synthetic
`__global__` tab renders through `Tabs` but is outside persisted cluster
ordering, close, reorder, and drag payloads; translate DOM drop indices past it
before updating cluster order. While Global is active no cluster tab is
selected; clicking Global keeps the foreground kubeconfig and restores the last
Global view. It never keeps an empty transfer source open.

## Shared cluster tabs across app windows

A cluster tab is one app window's view of a shared cluster workspace
([lifecycle](../architecture/application-lifecycle.md#cluster-owned-panel-workspaces)).
Its context menu has three actions with shared menu icon styling, no heading,
and a separator before Close, matching object-panel tab menus:

- **Open in new window** adds another app view, keeping the source tab and
  shared panel placements.
- **Move to new window** transfers the tab through the lifecycle below.
- **Close** runs the clicked tab's cluster-close transition, even if inactive.

Moves (drag or menu) share one lifecycle:

- A new destination window is seeded with the cluster before its renderer
  starts.
- The move carries the source view's navigation, namespace, filters, and docked
  panels. An existing destination tab is reused and keeps its navigation;
  incoming docked panels append. Floating panel windows keep position and
  cluster identity.
- The source stays until the destination publishes and acknowledges exact
  reconstruction and the backend commits; the runtime retains both views until
  then, so moving never disconnects the cluster. Failure or cancellation keeps
  the source.
- A cluster's last tab can move to an existing or new app window; the source
  window then closes only if its authoritative cluster tab set is empty. Release
  the transfer lock before native closure because close hooks can run
  synchronously.

## Validation

Run targeted tab and consumer (object-panel, diagnostics, cluster, dockable)
Vitest suites and typecheck, preserving tab ids and persisted cluster ordering;
verify drag/drop with
a real drop in the app ([native checks](dockable-panels.md#validation)).
