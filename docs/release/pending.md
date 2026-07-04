### Added

- Accessible-namespace entries that don't resolve are flagged in the sidebar: a warning glyph marks a namespace that was not found (or that the identity cannot access), with the detail in its tooltip.
- Per-cluster "accessible namespaces" ([#243](https://github.com/luxury-yacht/app/issues/243)): identities without permission to list namespaces cluster-wide can now add the namespaces they can access directly in the sidebar (with a hover delete on each added row). When a scope is set, tables, Browse, streams, metrics, and the object map all operate per-namespace — one namespace the identity cannot read degrades only itself. Views whose data source still reads cluster-wide (Events, Autoscaling, Helm, Gateway API) show their permission-denied state for scoped identities rather than empty data. The scope also works as a noise/performance filter on large clusters for users with full access.
- The Cluster Overview's Resource Utilization card now shows "Collecting metrics…" while the first metrics collection is in flight.

### Changed

- Views backed by a domain the identity cannot read now settle immediately into an "Insufficient permissions" state instead of an endless loading spinner, and stop retrying (both the table query and its stream stop asking until permissions or the namespace scope change).

- Clusters where the user lacks permission to list namespaces now fail fast. The sidebar shows "You do not have permission to list namespaces."
- The Cluster Overview no longer requires node permissions ([#244](https://github.com/luxury-yacht/app/issues/244)). Identities without node access (such as the standard `view` role) now see pods, namespaces, workloads, and events instead of the page failing with "permission denied". Each affected card explains its own gap in place: the Nodes card notes the missing node permission, and Resource Utilization indicates when cluster capacity or pod requests/limits are unavailable.
- Resource bars now render the portion of usage that exceeds the declared limits as a striped overlay, so the limit position stays visible even when the bar is fully red.

### Fixed
