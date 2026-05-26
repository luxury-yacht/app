### Added

### Changed

- Made Browse more reliable for large clusters by keeping loaded pages, refresh updates, namespace-scoped results, and filter options aligned as the catalog changes.
- Improved Browse catalog consistency so initial loads, manual refreshes, and live updates stay aligned on rows, counts, filters, and loading progress.
- Improved multi-cluster refresh reliability by keeping each cluster's enabled scopes, stream startup, cleanup, and in-flight refresh state isolated in its own runtime.
- Improved port-forward reliability so stopped sessions, failed starts, and cluster disconnects update the session list and status indicators consistently.
- Improved shell session reliability so terminal sessions close cleanly, disappear from session indicators promptly, and do not report duplicate close events after user or cluster cleanup.
- Improved the Sessions indicator so shell sessions and port forwards stay visible while startup data loads, then clear stale rows consistently after sessions stop or clusters disconnect.

### Fixed
