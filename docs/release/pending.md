### Added

- Left/right arrow keys can be used to navigate pages in paginated tables.

### Fixed

- Cluster initialization should no longer hang on unknown API versions of CRDs. Unknown CRDs will be flagged in the Application Logs, but cluster init should proceed normally.
