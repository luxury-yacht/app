### Added

### Changed

- Made Browse more reliable for large clusters by keeping loaded pages, refresh updates, namespace-scoped results, and filter options aligned as the catalog changes.
- Improved Browse catalog consistency so initial loads, manual refreshes, and live updates stay aligned on rows, counts, filters, and loading progress.
- Improved multi-cluster refresh reliability by keeping each cluster's enabled scopes, stream startup, cleanup, and in-flight refresh state isolated in its own runtime.

### Fixed
