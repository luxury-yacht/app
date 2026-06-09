### Added

- Every resource table can now export **all matching rows** (not just the visible page) to
  a CSV file, via an Export button beside the Copy action. Copy still copies the current
  page to the clipboard; Export pulls the full filtered result set and saves it to a file
  you choose.

### Changed

- Resource tables now present the Save (favorite) and Copy-as-CSV export actions as one
  consistent group in the filter bar, in the same position on every view (previously the
  favorite button's placement varied between views). On the catalog-backed views (Browse,
  Custom resources) the "export all matching rows" action joins the same group.
- A table's filter bar now shows its result count (and the accompanying tooltip)
  only while a filter is active — it reports how many rows match your filter. Total
  and page counts continue to live in the pagination footer, so the filter bar no
  longer duplicates that information.

### Fixed

- Resource tables no longer flash a loading spinner or "no data available" when
  you re-visit a view you've already opened. Every table now shows the rows it
  had last time for that cluster/namespace immediately on return and refreshes
  in the background; the loading spinner appears only on the first-ever load.
