### Added

### Changed

### Fixed

- Resource tables no longer flash a loading spinner or "no data available" when
  you re-visit a view you've already opened. Every table now shows the rows it
  had last time for that cluster/namespace immediately on return and refreshes
  in the background; the loading spinner appears only on the first-ever load.
