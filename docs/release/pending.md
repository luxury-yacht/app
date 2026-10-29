### Added

- Support for rolling back Helm releases.

### Changed

- Status columns in all tables use formatted status chips for faster visual scanning of anomalous data.

### Fixed

- High CPU use with many cluster tabs open:
  - Inactive clusters no longer reject and re-request live updates in a tight loop.
  - Application Logs no longer copy their whole history for every new line.
  - The first cluster opened in a session is no longer kept fully loaded after you switch away from it.
