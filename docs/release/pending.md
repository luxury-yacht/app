### Added

- **Custom Columns**
  - You can now add columns derived from object metadata (labels and annotations).
  - The Columns dropdown now has an `Add` button. This opens a modal to select a metadata field to use as a source for a new column.
  - Custom columns can be renamed and deleted via hover icons in the Columns dropdown.
- **Change Column Order**
  - Drag and drop to change the order of columns in a table.

### Changed

- The namespace Network view's free-form Details column is replaced by three
  aligned columns: **Context**, **Network**, and **Summary**. Rows label their
  own resource-specific meaning (such as Type, Class, Parent, Service, Cluster
  IP, Hosts, or Ports), related-object values open the referenced object, long
  lists collapse to "first +N" with the full list in the tooltip and search,
  narrow cells preserve their label and truncate only the portion of the value
  that does not fit, and summaries render as plain label/value text with warning
  emphasis reserved for not-ready endpoints. Context and Network are sortable;
  search matches everything, including collapsed hosts.
- Redesigned the Columns dropdown to support the new features. Additionally:
  - Columns that cannot be hidden are indicated with a lock icon.
    - Locked visibility columns can still have reordered.
  - The new `Reset` button resets all of the column state (order, width, and visibility) to default.
  - The new `Only` button (on hover over an item) selects only that column and hides others.
- Column visibility and order is stored in Favorites.
- The new "Only" button, as well as cosmetic changes from the Columns dropdown, have been applied across all dropdowns throughout the app.
- Diagnostic panel redesign.
  - The `Refresh Domains`, `Streams`, and `Broker Reads` tabs have been consolidated into two tabs
    that more closely follow the actual data flow.
    - `Cluster Data` shows a hierachical view of clusters, scopes, and domains.
    - `Connections` lists the sockets and reads that belong to no domain.

### Fixed

- Resource tables no longer claim that no workloads, pods, or other resources
  exist when an initial Kubernetes list misses its sync deadline. They remain
  visibly partial while the list retries and become complete once it succeeds.
- Initial cluster loading now limits the pre-deadline ingest request burst and
  starts the Pod/workload feeds first, avoiding contention that could delay the
  Workloads view past its readiness deadline. Degraded-ingest warnings now name
  bespoke resources instead of logging an empty resource identity.
- Duplicate Favorite names are now rejected. It's no longer possible to create different Favorites with the same name.
- An unreachable previously opened cluster no longer blocks startup UI,
  kubeconfig discovery, cluster-tab changes, or app-global controls while its
  cancellable connection attempt continues in the background.
- Copy Application Logs now uses the native desktop clipboard.
