### Added

- Table-based views are now paginated, loading a page at a time instead of loading every row up front. Page size is configurable per-view.
  - A new **Default page size** setting under Settings → Display lets you choose how many rows tables show by default.
- Tables have buttons to copy to clipboard or export to a file. This captures all of the data in the current view (all data, not just the current page) in CSV format.
- The YAML editor now warns when your edit would take ownership of fields managed by another controller.

### Changed

- The app is more resilient about reconnecting to clusters after temporary outages. It's also better at differentiating between network reachability vs. authentication problems.
  - Auth failures now continuously retry instead of giving up after 4 attempts.
- Improved caching of view data. This should make the app feel more responsive because you only have to wait for data to load on the first visit.
- Improved highlight color for selected text in the YAML editor. Syntax-highlighted code stays readable, and is the same in both read-only and edit modes.

### Fixed

- Cut, Copy, Paste, and Select All now work correctly in the YAML editor.
- Pod context/actions menus now reliably show all actions that you have permissions to perform.

### Refactoring

- Most of the work in this release was under-the-hood, and has little direct effect on what you see, but should hopefully make the app more reliable. The cluster connection, refresh, session, and large-table systems were substantially reorganized for reliability and performance. Permission checks and object identity handling were centralized so behavior stays consistent and predictable.
