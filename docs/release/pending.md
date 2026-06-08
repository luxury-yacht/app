### Added

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
