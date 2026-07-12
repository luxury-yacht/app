# Dockable Panels Contract

Dockable panels let object panels live in docked, floating, and grouped tab
surfaces. They are app-shell state, but the objects inside them remain
cluster/object scoped.

## Agent Contract

- Panel tabs must preserve full object identity, including `clusterId`, `group`,
  `version`, `kind`, namespace, and name.
- Opening an object should use the dockable panel context; do not manually splice
  panel state from feature code.
- Moving tabs between groups must preserve active tab, group membership, and
  object-panel state.
- Floating group ids must remain stable for the lifetime of the group.
- The visible group shell owns focus and keyboard behavior for the group.
- Closing a panel tab must clean only that tab's state and must not affect other
  clusters or groups.
- Transient unmounts such as cluster-tab switches should preserve object-panel
  refresh/cache state. Actual panel close is the cache-eviction boundary.
- **Tab-group content renders in the group LEADER's React subtree.** The
  leader renders every tab's captured children, so React context resolves
  against the leader's tree, not the originating panel's. Any per-panel
  context provider (e.g. `CurrentObjectPanelContext`) must wrap the children
  passed INTO `DockablePanel` so the provider travels with the content.
  Wrapping `DockablePanel` itself silently feeds grouped tabs the leader
  panel's context (regression test:
  `ObjectPanel.groupLeaderContext.test.tsx`).
- Layout CSS and measured group geometry are part of behavior; do not remove
  geometry transfer without replacing it.
- Menus and other transient surfaces opened from docked content must render
  through their shared body-level portal. Do not weaken the panel's scrolling
  or overflow boundaries to make an inline surface visible.

## Ownership

- Dockable provider/state/actions: `frontend/src/ui/dockable`
- Object panel integration and cache eviction:
  `frontend/src/modules/object-panel`,
  `frontend/src/modules/object-panel/contexts/ObjectPanelStateContext.tsx`
- Shared tab behavior: [tabs.md](tabs.md)
- Keyboard/focus behavior: [keyboard.md](keyboard.md)

## Placement Rules

- Prefer opening in the currently active compatible group.
- Preserve existing tab state when an already-open object is focused.
- Dragging within a tab bar reorders.
- Dragging to another compatible tab bar moves.
- Dropping away from a tab bar may create or use a floating group according to
  dockable state rules.
- A floating group moves from any non-interactive header space, including blank
  tab-strip space. Tabs, close buttons, and panel controls retain their own
  pointer behavior and must not start a group move.

## Change Checklist

When changing dockable behavior:

1. Trace object identity from link/action to panel tab state.
2. Verify docked, floating, grouped, close, and move behavior.
3. Confirm focus stays in the visible group shell.
4. Confirm cluster tab switches do not rewrite object-panel identity.
5. Confirm unmount preserves scoped refresh state and close evicts only the
   closed panel's scopes.
6. Add reducer tests for state changes and component tests for visible behavior.

## Validation

Run targeted dockable/object-panel tests and typecheck. For drag/floating
changes, verify manually in the app.
