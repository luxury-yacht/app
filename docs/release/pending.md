### Added

- Every resource table now has a consistent **Copy · Export** pair with a **scope toggle**,
  in the same place on every view. Copy puts rows on the clipboard; Export saves them to a
  CSV file. The toggle chooses the scope for both: off (default) acts on the current page,
  on acts on **all matching rows** across every page. Both always respect your active
  filters, and the button labels say which scope is active so nothing is exported silently.
  Browse and the Custom-resource views use the same mechanism as the rest of the app (the
  separate server-side catalog export was retired in favor of this one path).

### Changed

- A table's filter bar now shows its result count (and the accompanying tooltip)
  only while a filter is active — it reports how many rows match your filter. Total
  and page counts continue to live in the pagination footer, so the filter bar no
  longer duplicates that information.

### Fixed

- Resource tables no longer flash a loading spinner or "no data available" when
  you re-visit a view you've already opened. Every table now shows the rows it
  had last time for that cluster/namespace immediately on return and refreshes
  in the background; the loading spinner appears only on the first-ever load.
