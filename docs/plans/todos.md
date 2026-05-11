# TODO

- Restarting deployment does not show 2/3 in the table
- Debug panels are too easy to forget about, need a ref somewhere
  - Debug menu only available in dev mode?
  - Move app logs & deb ug to this menu?
  - Browser console?
- Settings
  - Setting to show Debug menu? Requires restart?
- Map view -- max default zoom when object count is low

## Feature Ideas

- In daemonset details, show a "NOT RUNNING ON" label that lists the nodes where the ds is missing

- Configurable backend thresholds
  - QPS (500) and Burst (1000)
  - SSRR concurrency cap (32)

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
