### Added

- Numbered page jumps in query-backed tables and Browse: a "Page N of M" input appears in the pagination footer whenever the total is exact, and jump landings show their exact serve-time position.

### Changed

- Backward paging in query-backed tables now uses backend-minted previous-page cursors, so it works from any landing (including jumps) and matches Browse.
- Copy/Export "all matching rows" now detects when the cluster's data changes mid-export: it retries once, then delivers the export with a visible warning instead of failing outright.
- Page turns on large tables are much faster while the data is quiet (the backend reuses the page index across requests instead of rebuilding it per page).

### Fixed

- On busy clusters, paging past page 1 no longer leaves the pagination spinner running forever with the prev/next buttons disabled — background live refreshes of the current page are now quiet and no longer show as user-blocking activity.
- Jump-to-object: navigating to an object from another view (object panel links, related rows, object map) now lands on the page containing it — under the table's current sort and filters — instead of only working when the object happened to be on the loaded page. If the object is filtered out or gone, the table says so and shows the first page.
