### Added

- Error notifications now have a "Copy error" button that copies the full error — message, technical details, suggestions, and context — to the clipboard for easy pasting into bug reports.

### Fixed

- Tables now load as soon as their own data is ready during cluster connection: one slow or failing watch (for example a misbehaving CRD or restricted resource) no longer delays every other view's first load.
- Switching the active cluster no longer briefly shows the previous cluster's rows in a table before the new cluster's data loads.
