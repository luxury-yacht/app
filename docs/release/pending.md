### Added

- Every resource table with a filter bar now has a consistent **Copy · Export** pair, in the
  same place on every view (including the object panel's Pods and Jobs tabs). Copy puts rows
  on the clipboard; Export saves them to a CSV file. Both always act on **all matching
  rows** across every page, respecting your active filters — what you filtered is what you
  get, never just the visible page. Browse and the Custom-resource views use the same
  mechanism as the rest of the app (the separate server-side catalog export was retired in
  favor of this one path). The object panel's Events tab is the one exception — it is a bare
  presentation list without a filter bar.

### Changed

- Single-namespace resource views (Pods, Workloads, Config, Network, RBAC, Storage, Events,
  Autoscaling, Quotas, Helm) now paginate and load server-side, just like the all-namespaces,
  cluster, and Browse/Custom views — previously they loaded a whole namespace at once with no
  pagination controls. Pagination is now consistent across every resource view, and large
  single namespaces no longer load everything in one shot.
- The object panel's Pods tab (a workload's or node's pods) now paginates and loads server-side
  too, with backend-side search/sort/filter — so opening the Pods tab on a Deployment, DaemonSet,
  or Node that owns thousands of pods no longer loads them all at once.
- When a filter is active, every resource table (cluster, namespace, Browse, Custom, events —
  no exceptions) now shows a single consistent banner: **"showing N of M items due to filters,"**
  where N is how many rows match your filter and M is how many are in scope without it — both
  real totals, not the current page. With no filter active there is no banner. The old
  "bounded local snapshot" / "applies only to the visible rows" note is gone (it no longer
  applies now that filtering and sorting run server-side across the whole dataset); pagination
  position still lives in the footer.

- The **"Maximum table rows"** advanced setting was removed. Tables paginate and filter
  server-side now, so the client-side row cap no longer did anything; a previously persisted
  value is ignored.
- Browse's default page size changed from 1000 to 50 rows. Large catalogs open much faster;
  the page-size selector still offers up to 1000 per page.
- The Cluster CRDs view no longer shows a Kind filter dropdown — every row there is a
  CustomResourceDefinition, so the dropdown had exactly one option. Search and the other
  filters are unchanged.

### Added

- New setting: **Settings ▸ Display ▸ Tables ▸ Default page size** (default 50). It sets the
  rows-per-page for any table that doesn't have a saved page size yet; picking a page size in
  a table's footer still overrides it for that table. The dropdown offers the same values as
  every pagination footer — they share one list in the app.

### Fixed

- Resource tables no longer flash a loading spinner or "no data available" when
  you re-visit a view you've already opened. Every table now shows the rows it
  had last time for that cluster/namespace immediately on return and refreshes
  in the background; the loading spinner appears only on the first-ever load.

- Filtering is now quiet and consistent in every view: changing filters or
  typing in the filter box no longer dims the table or shows a loading spinner
  while the refreshed rows load — the current rows stay up and swap in place.
  This also fixes the filter input losing keyboard focus while typing when the
  filter text had no matches.
