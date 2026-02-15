# TODO

## Issues

## Feature Ideas

- Add browser inspect to view menu

- Multiple panels in the same location use tabs
  - For example, two panels docked to bottom creates a tab per panel in the header
  - Diag Panel, Port Forwards OK
  - App Logs would need to move controls down
  - Object Panel would need to move controls, badge, object name down
- Tearaway support
  - Show target zones (new floating, existing floating, opposite docked location)
- Only one docked container in each docked location
- Support multiple floating windows, each its own container with tab support

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

- Ephemeral debug containers
  - kubectl debug

- ArgoCD integration to show drift
  - Would need permission to query the argo API

## Wails v3 (when ready)

- Multiple windows
  - Object Panel, logs, diagnostics in its own window

- Automatic app updates
