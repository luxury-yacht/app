# TODO

## Modal and Keyboard Cleanup

Critical (should fix)

1. useKeyboardSurface re-registers on every render — surfaces.ts

The useEffect includes onKeyDown, onEscape, and onNativeAction in its dependency array. Many callers pass inline arrow functions (e.g., ContextMenu.tsx, Dropdown.tsx,
SidebarKeys.ts), so the effect re-runs every render. Each re-run calls unregisterSurface then registerSurface, creating a new surface ID and resetting registeredAt ordering. The
updateSurface code path is effectively dead code.

Fix: Store callbacks in refs (like useShortcut does with handlerRef) so they aren't part of the dependency array.

2. Module-level openModalStack in useModalFocusTrap.ts leaks between tests

The openModalStack array is module-level state. If a test unmounts without cleanup or errors out, orphaned entries persist and cause test pollution. Also a concern for HMR during
development (module reloads but DOM inert attributes may be stale).

Fix: Export a \_resetForTest function and call it in afterEach, or use a context-based stack.

---

Important (should fix)

3. Dead void priority parameter in useModalFocusTrap — The priority parameter is accepted but immediately discarded. Remove it from the interface or add a deprecation comment.

4. Vestigial data-fav-modal-focusable attributes in FavSaveModal.tsx — These data-\* attributes no longer serve as selectors since useModalFocusTrap now uses getTabbableElements
   with a standard selector. Should be cleaned up to avoid confusion.

---

Suggestions (nice to have)

5. Dual Tab-handling path — Tab is handled by useModalFocusTrap's capture-phase listener, while other keys go through the surface system's bubble-phase listener. This is correct
   but creates a subtle ordering dependency that should be documented in keyboard-handling.md.

6. Simplify .closest() selectors — target.closest('.object-panel-body \*') in ObjectPanel.tsx and DiagnosticsPanel.tsx can be simplified to target.closest('.object-panel-body')
   for the same effect.

7. getTabbableElements calls getComputedStyle for every candidate — Could check hidden attribute and aria-hidden first (cheap) before falling back to getComputedStyle (forces
   style recalculation).

## Other

- Add a delete option to the favorites menu

- API timestamp
  - Empty log lines dropping color, dropping pod name

- Logging
  - Auto-detect log levels?
    - Colorize INFO ERROR DEBUG etc
  - Advanced log formatting
    - pattern matching by pod name/deployment name
    - design a color-coding map for custom formats
    - attempt to automatically parse?

- can we get node logs?

- Allow remove of default kubeconfig path, if not the last

- Resource creation
  - starter templates for common resource types
  - reuse the existing code editor

## Issues

- Large cluster pagination — views other than Browse (e.g. Pods) load all items in one request. On clusters with thousands of resources this could be slow. Consider adding pagination/Load More to all grid table views.

## Feature Ideas

- Gridtable improvements
  - Allow column order change via drag
    - should reset button also reset to default column order?
      - probably not because that reset is for filters
  - Pods view, change default column order to Name, Owner, Namespace

- Transfer files to/from pods
  - Select container
  - can we show a file dialog for the remote filesystem?

- More deployment options
  - Container scope:
    - set image
      - show a list of containers and their images, allow override
    - update resource requests/limits

- Metrics over time
  - Graphs instead of only point-in-time numbers
  - No persistence, just show metrics for the current view, drop them when the view changes

- Helm install/upgrade/delete
  - track deployments, offer rollbacks?

- Multi-select/batch operations
  - Allow batch operations, but could be dangerous

## Wails v3 (when ready)

- Multiple windows
  - Object Panel, logs, diagnostics in its own window

- Automatic app updates
