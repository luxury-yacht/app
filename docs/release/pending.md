### Added

### Changed

- Table data now refreshes purely on server push while streams are healthy: live
  CPU/memory usage is joined into rows by the backend at serve time, and a new
  server-side "metric doorbell" tells the app when fresh metrics were collected
  — eliminating client-side polling, the multi-request metric overlay, and the
  giant row-key query strings. CPU/memory sorting runs server-side with correct
  pagination.

### Fixed
