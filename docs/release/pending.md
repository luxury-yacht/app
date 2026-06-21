### Changed

- Large-cluster resource tables (all-namespaces pods, namespace workloads, and cluster nodes) are lighter and open faster. These views render a server-paginated query, not the live stream, so their live subscription now delivers only the "something changed, refetch" signal — the full row set it used to ship across the bridge, retain, and re-sort on every update is no longer sent, and the one-time full-row fetch on opening the view is skipped.
- Diagnostics panel Streams table is now a hierarchy instead of a flat list. Delivery/error counts break down by cluster and scope.
- The object panel's actions menu (delete, restart, scale, rollback, trigger, suspend, port-forward) now runs through the same shared action controller as the cluster/namespace table views, so confirmation dialogs, the scale modal, and permission gating behave identically everywhere. Action failures now surface through the standard error notifications instead of an inline banner.
- Object-panel Overviews are now rendered from a single data-driven descriptor per resource kind instead of bespoke per-kind components.

### Fixed

- Views no longer get stuck on a loading spinner the first time you open a view that has none of that resource.
- Object details now show an Age for every resource type, including custom resources, and the value always matches the Age shown in the cluster/namespace browse tables. Age is now derived once from the object's creation timestamp instead of per resource type.
