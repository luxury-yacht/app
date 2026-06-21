### Added

### Changed

- Large-cluster resource tables (all-namespaces pods, namespace workloads, and
  cluster nodes) are lighter and open faster. These views render a
  server-paginated query, not the live stream, so their live subscription now
  delivers only the "something changed, refetch" signal — the full row set it
  used to ship across the bridge, retain, and re-sort on every update is no
  longer sent, and the one-time full-row fetch on opening the view is skipped.
  The effect grows with cluster size and churn; small clusters are unaffected.
- The Diagnostics → Streams table is now a hierarchy instead of a flat list.
  Sessions and Last Connect move up to a per-stream header (each stream is one
  socket), and delivery/error counts break down by their natural child: the
  Resources stream by cluster → resource domain, Container Logs by cluster → the
  pod/object being tailed, Events by cluster → scope (cluster / namespace), and
  Catalog by cluster. This makes it clear which cluster and which subscription a
  given backlog or error belongs to.
- The object panel's actions menu (delete, restart, scale, rollback, trigger,
  suspend, port-forward) now runs through the same shared action controller as
  the cluster/namespace table views, so confirmation dialogs, the scale modal,
  and permission gating behave identically everywhere. Action failures now
  surface through the standard error notifications instead of an inline banner.

### Fixed

- Browse tables (Storage and other resource views) no longer get stuck on a
  loading spinner the first time you open a view for a namespace or cluster that
  has none of that resource. The empty result now settles to the "no objects
  found" state instead of waiting forever for data that will never arrive.
- Object details now show an Age for every resource type, including custom
  resources, and the value always matches the Age shown in the cluster/namespace
  browse tables. Age is now derived once from the object's creation timestamp
  instead of per resource type.
