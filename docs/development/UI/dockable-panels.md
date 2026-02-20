# Dockable Panels and Tabs

This document explains how dockable panels work in Luxury Yacht, with emphasis on tab grouping, focus, and moving tabs between groups.

## Scope

The dockable system described here is implemented in:

- `frontend/src/ui/dockable/*`
  - Core components: `DockablePanel.tsx`, `DockablePanelProvider.tsx`, `DockableTabBar.tsx`, `DockablePanelHeader.tsx`, `DockablePanelControls.tsx`
  - State: `panelLayoutStore.ts`, `useDockablePanelState.ts`, `tabGroupState.ts`, `tabGroupTypes.ts`
  - Interaction hooks: `useDockablePanelDragResize.ts`, `useDockablePanelMaximize.ts`, `useDockablePanelWindowBounds.ts`
  - Layout helpers: `dockablePanelLayout.ts`
- Object panel integration points in:
  - `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanel.tsx`
  - `frontend/src/modules/object-panel/hooks/useObjectPanel.ts`
  - `frontend/src/core/contexts/ObjectPanelStateContext.tsx`

`DockablePanel`, `DockableTabBar`, `useDockablePanelState`, and dockable context hooks must be used under `DockablePanelProvider`.

## Mental model

There are two separate but coordinated state layers:

1. **Panel layout state** (`useDockablePanelState`)

- Per `panelId`: open/closed, dock position (`right|bottom|floating`), size, floating coordinates, z-index.
- Backed by a provider-scoped `panelLayoutStore` owned by `DockablePanelProvider`.

2. **Tab group state** (`DockablePanelProvider` + `tabGroupState` helpers)

- Group membership and ordering:
  - `right` group (single dock strip)
  - `bottom` group (single dock strip)
  - `floating` groups (multiple independent tab groups, each with `groupId`)
- Active tab per group.

Both layers must remain aligned. Group operations update panel position, and panel position changes re-sync group membership.

## Panel identity and multi-cluster behavior

Object panels are keyed by deterministic IDs (`objectPanelId`) in this format:

- `obj:{clusterId}:{kind}:{namespace}:{name}`

This is critical for multi-cluster safety:

- Same object name in different clusters does not collide.
- Re-opening the same object focuses the existing tab instead of creating duplicates.

Object panel state is also stored per active cluster tab in `ObjectPanelStateContext`, so each cluster tab has independent open object panels.

## How object opening chooses where tabs go

Opening an object flows through:

1. `useObjectPanel().openWithObject()` adds/gets the panel ID in object panel state.
2. `AppLayout` renders `<ObjectPanel panelId=... />` for each open entry.
3. `ObjectPanel` resolves a concrete target group with `getPreferredOpenGroupKey('right')`.
4. `ObjectPanel` passes both `defaultPosition` and `defaultGroupKey` into `DockablePanel`.
5. `DockablePanel` initializes layout state, then `syncPanelGroup(panelId, position, preferredGroupKey)` assigns tab-group membership.

Placement rules currently implemented:

- If no valid focused panel group exists, new object panels default to **right docked**.
- If a focused group exists, new object panels follow that group position.
- If a focused floating group exists, new floating panels join that exact floating group as tabs (not a new floating window).
- Moving a panel to another group sets focus to the destination group so the next open follows it.

## Focus model (important)

`DockablePanelProvider` tracks focus with `lastFocusedGroupKey`.

Important implementation details:

- Focus is updated from panel interactions (`onMouseDownCapture` in `DockablePanel`), and programmatic focus paths (`focusPanel`, move operations).
- Provider uses both state and a ref for focus key to avoid same-tick stale reads.
- Moving to `'floating'` may create a new generated floating group ID; provider uses a deferred resolution step to discover the new group and mark it focused.

If you add a new panel move/open path, ensure it updates focused group tracking, or new object opens may fall back to right docking unexpectedly.

## Tab groups and floating group IDs

`tabGroupState.ts` contains pure immutable helpers.

Key rules:

- `addPanelToGroup(..., 'floating')` creates a **new** floating group.
- `addPanelToFloatingGroup(panelId, groupId)` appends/inserts into an existing floating group.
- `movePanelToGroup` removes from source first, then inserts into destination.
- Empty floating groups are removed automatically.
- Floating IDs are generated deterministically (`floating-N`) based on current state.

Do not assume floating IDs are sequential in UI time; they are state-derived and can skip numbers after group deletion.

## Rendering model: group leader pattern

A non-obvious but important behavior in `DockablePanel.tsx`:

- Each panel instance still exists, but only one panel per group is the visible **group leader**.
- `groupLeaderByKeyRef` keeps a stable leader to prevent visual container jumping when tab order changes.
- If leadership changes, layout state is copied from previous leader (`copyPanelLayoutState`) to prevent geometry flicker.
- Non-leader panels are hidden (`display: none`), but their content is rendered through leader-managed content refs.
- Group-leader tracking and shared hover-suppression counters are provider-owned runtime refs (not module-level globals), scoped to the active `DockablePanelProvider`.

This design allows tab order changes and group membership changes without remounting/flickering the physical panel shell.

## Tab bar behavior

`DockableTabBar` behavior to know:

- Tab bar is shown even for single-tab groups (consistency).
- New tabs and newly selected tabs are auto-scrolled into view.
- Overflow arrows appear when tabs exceed width; arrows scroll the strip horizontally.
- Drag threshold (`DRAG_THRESHOLD`) prevents accidental drags.
- Undock threshold (`UNDOCK_THRESHOLD`) requires vertical distance from bar before creating a floating panel.
- Tab bars initiate drag and register DOM nodes; provider owns global drag listeners and drop commit logic.
- Cross-group drop target is resolved from hovered DOM bar (`document.elementFromPoint`) to avoid intermittent race conditions.

## Drag/drop and undocking behavior

When dragging tabs:

- Same-group drop reorders tabs.
- Cross-group drop moves tab into target group at computed index.
- Dropping away from any tab bar (past undock threshold) creates a floating panel.
- Drag session state (`dragState`) is provider-owned, so the drag preview and drop targeting remain consistent across group boundaries.

When undocking from mouse position:

- Drop coordinates are interpreted relative to `.content` bounds.
- Floating panel top-left is set to drop position.
- Position is clamped so panel stays fully visible inside content bounds whenever possible.

## Closing behavior

Close button behavior is tab-aware:

- If group has multiple tabs: closes the active tab only.
- If last tab: closes the whole panel.

Object panel close paths call `clearPanelState(panelId)` so reopening gets clean defaults instead of stale dock position/size.

## CSS/layout interactions

- Docked offsets are communicated via CSS variables:
  - `--dock-right-offset`
  - `--dock-bottom-offset`
- Only the current group leader writes these variables.
- Provider renders panels into a dedicated `.dockable-panel-layer` attached under `.content`.

## Developer pitfalls and invariants

1. Keep group state and panel layout state aligned.

- If you add new move/close/open operations, update both layers.

2. Preserve focus semantics.

- New object opens depend on focused group tracking.
- Any move-to-panel operation should set destination focus.

3. Maintain multi-cluster-safe IDs.

- Object panel IDs must keep `clusterId` in identity.

4. Do not remove group-leader geometry transfer without replacement.

- It prevents visible jumps/flicker during leader changes.

5. Keep tab-group helpers pure.

- `tabGroupState.ts` assumes immutable state transitions and is heavily tested.

## Test coverage to update when changing behavior

Primary tests live in:

- `frontend/src/ui/dockable/tabGroupState.test.ts`
- `frontend/src/ui/dockable/DockablePanelProvider.test.tsx`
- `frontend/src/ui/dockable/DockablePanel.test.tsx`
- `frontend/src/ui/dockable/DockablePanel.behavior.test.tsx`
- `frontend/src/ui/dockable/DockableTabBar.test.tsx`
- `frontend/src/ui/dockable/DockableTabBar.drag.test.tsx`
- `frontend/src/ui/dockable/DockablePanelControls.test.tsx`
- `frontend/src/ui/dockable/useDockablePanelState.test.tsx`
- `frontend/src/ui/dockable/useDockablePanelWindowBounds.test.tsx`

For object open routing/focus interactions, also validate:

- `frontend/src/modules/object-panel/hooks/useObjectPanel.test.tsx`
