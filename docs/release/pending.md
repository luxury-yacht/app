### Added

### Changed

### Fixed

- Canceled permission checks no longer produce bursts of duplicate error reports after a cluster connection fails.
- Permission denials and recognized cancellations, expired credentials, and missing Kubernetes objects stay in local diagnostics instead of creating Sentry error reports.
