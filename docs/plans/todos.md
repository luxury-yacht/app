# TODO

## Issues

## Feature Ideas

- Add an "Include Metadata" option for Nodes that will allow you to filter on labels/annotations that aren't visible in the table rows.

- docked panels maybe should not obscure the content?
  - this is probably going to require some significant UI calculations for all the things

- Transfer files to/from pods
  - Select container
  - can we show a file dialog for the remote filesystem?

- Resource creation
  - starter templates for common resource types
  - reuse the existing code editor

- More deployment options
  - Workload scope:
    - pause (scale to zero)
    - resume (scale to previous)
      - can we get the previous count from the last replicaset?
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

- Ephemeral debug containers
  - kubectl debug

- ArgoCD integration to show drift
  - Would need permission to query the argo API

## Wails v3 (when ready)

- Multiple windows
  - Object Panel, logs, diagnostics in its own window

- Automatic app updates
