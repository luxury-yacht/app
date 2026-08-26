### Added

- Resource table Columns menus can create, rename, hide, reorder, and remove
  custom columns from a grouped picker of available Kubernetes label and
  annotation keys, with sample-value previews and direct deletion. Missing
  values use the shared `-` placeholder, and definitions retain the table's
  existing cluster/view/namespace persistence scope.

### Changed

- The diagnostics panel's Refresh Domains, Streams, and Broker Reads tabs are now
  two views that follow how the data actually flows.
  - **Cluster Data** groups scopes under their cluster and shows eight columns —
    Domain, Scope, Health, Feed, Count, Updated, Activity, Error — instead of
    twenty. Health is one badge rather than the old Status/Health/Stale trio, and
    Feed states which stream keeps a domain fresh together with what its poll is
    doing. A domain with a single scope is one row; expanding any row reveals the
    remaining fields (version, sync wait, metrics, resyncs, fallbacks, callers).
    Scopes no longer repeat the cluster name their header row already states,
    so a scope shows only what distinguishes it (or "cluster-wide").
  - A domain that is not currently running now reads **inactive** in neutral
    grey. It used to be reported as *degraded* or *unhealthy*, which implied a
    problem with a domain nobody was using; the header's issue count now counts
    exactly the rows whose badge shows a fault.
  - **Connections** lists the sockets, the stream children that are not refresh
    domains (event scopes, container-logs targets), and every read that belongs to
    no domain. It is deliberately flat: those things share no parent.
- Diagnostics summary cards lead with a single headline figure; the full
  breakdown moved into each card's tooltip.
- Broker read rows are now per cluster, so a call site's activity is attributed to
  the cluster it read from instead of folding every cluster into one row.
- Improvements to column handling in tables.
  - Column order can be changed via drag and drop in the dropdown.
  - Visible column headers can be dragged to reorder them wherever the Columns
    menu supports ordering; a hover grip identifies the drag surface.
  - Columns that cannot be hidden are indicated with a lock icon. Locked visibility columns can still have their order changed.
  - The new "Reset" button resets all of the column state (order, width, and visibility) to default.
  - The new "Only" button (on hover over an item) selects only that columns and hides others.
- Column visibility and order is stored in Favorites.
- The new "Only" button, as well as cosmetic changes from the Columns dropdown, have been applied across all dropdowns throughout the app.

### Fixed

- The Streams "Fallbacks" counter always read zero. It now counts the polls that
  ran because a stream was not delivering, which is what distinguishes "streaming
  is on" from "streaming is carrying the load".
