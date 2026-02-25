# TODO

## Issues

## Feature Ideas

- Gridtable improvements
  - Link behavior
    - Click to open in Object Panel
    - Ctrl/Cmd+click to go to that item in its view
  - Allow column order change via drag
    - should reset button also reset to default column order?
      - probably not because that reset is for filters
  - Right-click menu on table header
    - Sort asc/desc
    - Move column left/right
    - Hide column
    - Reset to defaults
  - Hover buttons to hide column, set sort?
  - Pods view, change default column order to Name, Owner, Namespace
  - Show number of items in tables
    - Perhaps an option to turn on row numbers?

- Move shell and port forward tracking to the status indicator tooltip instead of a panel tab

- Transfer files to/from pods
  - Select container
  - can we show a file dialog for the remote filesystem?

- Resource creation
  - starter templates for common resource types
  - reuse the existing code editor

- More deployment options
  - rollback
    - choose a replicaset or just roll back to the most recent?
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

- Favorites/bookmarks
  - Bookmark specific views

- Customize Cluster Overview
  - from a predefined set of widgets

- ArgoCD integration to show drift
  - Would need permission to query the argo API

## Wails v3 (when ready)

- Multiple windows
  - Object Panel, logs, diagnostics in its own window

- Automatic app updates
