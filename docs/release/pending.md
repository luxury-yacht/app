### Added

- Left/right arrow keys can be used to navigate pages in paginated tables.

### Fixed

- Cluster initialization should no longer hang on unknown API versions of CRDs. Unknown CRDs will be flagged in the Application Logs, but cluster init should proceed normally.
- Tables now load as soon as their own data is ready during cluster connection: one slow or failing watch (for example a misbehaving CRD or restricted resource) no longer delays every other view's first load.
