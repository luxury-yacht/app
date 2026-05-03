# TODO

- Show pods as cards instead of an embedded gridtable in node pods view
  - Object relationships map
  - Traffic flow map

- padding on full zoom
- zoom increments
- route tooltips
  - highlight route
  - fix reference
- 

- In daemonset details, show a "NOT RUNNING ON" label that lists the nodes where the ds is missing

- Cluster overview, show resource usage by workload type

## Feature Ideas

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
