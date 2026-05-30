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
- Layout CSS and measured group geometry are part of behavior; do not remove
  geometry transfer without replacing it.

## Ownership

- Dockable provider/state/actions: `frontend/src/ui/dockable`
- Object panel integration: `frontend/src/modules/object-panel`
- Shared tab behavior: [tabs.md](tabs.md)
- Keyboard/focus behavior: [keyboard.md](keyboard.md)

## Placement Rules

- Prefer opening in the currently active compatible group.
- Preserve existing tab state when an already-open object is focused.
- Dragging within a tab bar reorders.
- Dragging to another compatible tab bar moves.
- Dropping away from a tab bar may create or use a floating group according to
  dockable state rules.

## Change Checklist

When changing dockable behavior:

1. Trace object identity from link/action to panel tab state.
2. Verify docked, floating, grouped, close, and move behavior.
3. Confirm focus stays in the visible group shell.
4. Confirm cluster tab switches do not rewrite object-panel identity.
5. Add reducer tests for state changes and component tests for visible behavior.

## Validation

Run targeted dockable/object-panel tests and typecheck. For drag/floating
changes, verify manually in the app.
