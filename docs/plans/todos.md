# TODO

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
