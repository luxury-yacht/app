# Dockable Panel Tabs Design

## Context

The dockable panel system currently supports one panel per docked position (right, bottom). When a second panel tries to dock at an occupied position, the existing panel is closed (dock-conflict). This design adds tab support so multiple panels can share a docked area with tab labels in the header.

There are 4 panels: `object-panel` (right), `port-forwards` (right), `app-logs` (bottom), `diagnostics` (bottom). Panels at the same default position will naturally become tabs.

## Requirements

- All positions (right, bottom, floating) support tabs
- When a panel opens at an occupied position, it auto-joins as a tab (replaces dock-conflict close)
- Tab labels show panel title + close button
- Closing the active tab activates the adjacent tab (right, then left); closing the last tab destroys the group
- Full drag support: reorder tabs by dragging, drag a tab out to undock into a new floating panel, drag a tab onto another group's tab bar to move it there
- Visual drop target highlights when dragging onto another group's tab bar (not when creating a new floating panel)
- No edge-zone dock targets when dragging; use existing dock control buttons to change position
- Multiple floating tab groups supported (preserves current multi-float behavior)

## Architecture

The `DockablePanelProvider` becomes the owner of tab groups. Each docked position maintains an ordered list of panel IDs. The provider renders a single shared container per active tab group, with a tab bar in the header and only the active panel's body visible.

### Tab Group Model

```
tabGroups: {
  right:  { tabs: string[], activeTab: string | null }
  bottom: { tabs: string[], activeTab: string | null }
  floating: [
    { groupId: string, tabs: string[], activeTab: string | null }
    ...
  ]
}
```

Right and bottom are singletons (one tab group per edge). Floating is an array of independent tab groups, each with its own position, size, and z-index.

## Component Structure

### Current rendering flow

```
DockablePanelProvider
  portal host
    DockablePanel (object-panel) -> own header + own body
    DockablePanel (app-logs)     -> own header + own body
    ...each panel renders independently
```

### New rendering flow

```
DockablePanelProvider
  portal host
    DockableTabGroup (right)
      DockableTabBar -> [tab label + x] [tab label + x]
      DockablePanelControls -> dock/maximize/close
      active panel's body content
    DockableTabGroup (bottom)
      DockableTabBar -> [tab label + x]
      DockablePanelControls
      active panel's body content
    DockableTabGroup (floating-1)
      DockableTabBar -> [tab label + x]
      DockablePanelControls
      active panel's body content
    DockableTabGroup (floating-2)
      ...
```

### Components

| Component | Status | Role |
|-----------|--------|------|
| `DockableTabGroup` | New | Renders outer shell (positioning, resize, header) for a group of tabs. Takes over the container role from `DockablePanel`. |
| `DockableTabBar` | New | Renders tab labels with close buttons. Handles drag-to-reorder and drag-to-undock. |
| `DockablePanel` | Modified | No longer renders its own container/header. Registers with provider and renders only its body content when it's the active tab. |
| `DockablePanelHeader` | Modified | Contains the tab bar + controls instead of title + controls. |
| `DockablePanelProvider` | Modified | Manages tab groups, panel registration, tab switching, reordering, cross-group moves. |

## State Management

### Panel registration

When a `DockablePanel` mounts with `isOpen=true`, it calls `provider.registerPanel(panelId, { title, position, ... })`. The provider adds it to the appropriate tab group:

- If a tab group exists at that position: append as new tab, make active
- If no tab group exists: create one with this panel as sole tab
- For floating: always creates a new group (unless dropped onto an existing group's tab bar)

### State ownership

| State | Owner | Why |
|-------|-------|-----|
| Tab order, active tab | Provider (tab group) | Shared across panels in a group |
| Position (right/bottom/floating) | Provider (tab group) | The group is positioned, not individual panels |
| Size (width/height) | Provider (tab group) | All tabs share the same container size |
| Floating position (x, y) | Provider (tab group) | Group-level, not per-panel |
| `isOpen` | Individual panel | Each panel controls its own open/close lifecycle |
| Panel body content | Individual panel | Each panel renders its own content |
| z-index | Provider (tab group) | Group-level for floating groups |

Individual panels keep size preferences so that when undocked to a new floating group, they can restore a sensible default size.

### Tab switching flow

1. User clicks tab label -> provider sets `activeTab` on that group
2. Only the active panel's body renders (others hidden or unmounted)
3. Panel receives `isActiveTab` so panels can pause/resume work when not visible

### Close flow

1. User clicks x on a tab -> provider removes panel from group, panel's `onClose` fires
2. If tabs remain -> adjacent tab becomes active (right first, then left)
3. If no tabs remain -> group is destroyed, container removed

### Undock (drag-out) flow

1. User drags tab out of tab bar past a threshold
2. Provider removes panel from source group
3. Provider creates new floating group with that panel
4. New floating group positioned at drop point

### Cross-group move flow

1. User drags tab onto another group's tab bar
2. Provider removes panel from source group
3. Provider inserts panel into target group at drop position
4. Panel becomes active in target group

## Drag & Drop Visual Feedback

The provider tracks a `dragState` during tab drags:

```
dragState: {
  panelId: string
  sourceGroupId: string
  cursorPosition: { x, y }
  dropTarget: { groupId: string, insertIndex: number } | null
}
```

Each `DockableTabBar` checks `dragState.dropTarget` to render highlights.

| Drag target | Visual feedback |
|-------------|----------------|
| Over another group's tab bar | Accent highlight on tab bar + insertion line between tabs |
| Over the source tab bar | Insertion line at new position (reorder preview) |
| Over empty space | No highlight (drop creates new floating group) |
| Dragged tab itself | Ghost/reduced opacity at original position |

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Last tab closed in a docked group | Group destroyed, CSS offset vars reset to 0 |
| Last tab closed in a floating group | Group destroyed, removed from floating array |
| Panel unmounts while active tab | Same as close: remove from group, activate adjacent |
| Panel opens at occupied position | Joins existing group as new rightmost tab, becomes active |
| Two panels open simultaneously at same position | Both join/create group, last to register becomes active |
| Drag-undock the only tab in a docked group | Source group destroyed, new floating group created |
| Drag-undock the only tab in a floating group | Group moves with cursor (effectively dragging the window) |
| Panel re-opens after being closed | Rejoins group at stored position, or appends if invalid |
| Maximize while tabbed | Entire tab group maximizes |
| Resize while tabbed | Resizes the group container; all tabs share the same size |

## Testing Strategy

### Unit tests

| Component | Key test cases |
|-----------|---------------|
| `DockableTabBar` | Renders tab labels from group state, click switches active tab, close button removes tab and fires `onClose`, renders drop indicator when `dragState.dropTarget` matches |
| `DockableTabGroup` | Renders only active panel's body, passes through resize/drag to correct hooks, shows controls for active panel, maximizes entire group |

### Provider integration tests

- Panel registration creates/joins tab groups correctly
- Closing active tab activates adjacent tab (right, then left)
- Closing last tab destroys group
- Position change moves panel between groups
- Multiple floating groups coexist independently
- `dragState` updates propagate to tab bars

### Drag interaction tests

- Drag-to-reorder updates tab order within group
- Drag-to-undock creates new floating group at drop position
- Drag onto another group's tab bar moves panel and activates it
- Source group cleanup after drag-out (adjacent tab activated, or group destroyed if empty)
- Drop indicator appears/disappears correctly

### Regression tests

- Existing panel behavior (open, close, resize, dock position change) unchanged
- All four panels work in tabbed mode
- Keyboard shortcuts fire for active panel only
- `onMouseDown` stopPropagation on panel toolbars still prevents drag
