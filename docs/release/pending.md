### Added

- Every resource table with a filter bar now has a consistent **Copy · Export** pair with a
  **scope toggle**, in the same place on every view (including the object panel's Pods and
  Jobs tabs). Copy puts rows on the clipboard; Export saves them to a CSV file. The toggle
  chooses the scope for both: off (default) acts on the current page, on acts on
  **all matching rows** across every page. Both always respect your active filters, and the
  button labels say which scope is active so nothing is exported silently. Browse and the
  Custom-resource views use the same mechanism as the rest of the app (the separate
  server-side catalog export was retired in favor of this one path). The object panel's
  Events tab is the one exception — it is a bare presentation list without a filter bar.

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

### Fixed

- Resource tables no longer flash a loading spinner or "no data available" when
  you re-visit a view you've already opened. Every table now shows the rows it
  had last time for that cluster/namespace immediately on return and refreshes
  in the background; the loading spinner appears only on the first-ever load.
