# TODO

- Distinguish empty states more clearly.
  There are several different situations:
  - no logs yet
  - no previous logs found
  - no logs match filters
  - logs unavailable due to backend/runtime conditions
    These should stay visually distinct.
- Make previous-logs mode more visually obvious.
  A small mode badge like Previous logs near the toolbar would help, because it is easy to forget you are not looking at live logs anymore.

- Cursor turns to beam when dragging the app window in the header
- Center Mac icons in header

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
