### Added

### Changed

- Live CPU/memory usage is now joined onto table rows by the backend at serve
  time. Tables issue one query instead of two-to-three correlated requests, the
  giant `predicate.rowKeys` query strings are gone, and CPU/memory sorting runs
  server-side with correct keyset pagination.

### Fixed
