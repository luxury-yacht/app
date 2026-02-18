# TODO

## Issues

Components in two different places. `src/components` and `src/shared/components`. Why?

## Feature Ideas

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
