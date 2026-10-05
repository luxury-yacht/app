### Added


### Changed

- The timestamp button in container logs has a menu for switching between UTC and local time.
- The Pretty JSON and table buttons in the Logs tab are now one format button. Click it to cycle through Raw, Pretty, and Table, or pick one from its menu.
- The Pods, Containers, and Node Logs source dropdowns in the Logs tab now size to fit their contents.
- Search in the Logs tab now opens in its own row from the search button, or with ⌘F / Ctrl+F. Closing the row keeps the filter applied.
- Workload logs name the container on each line only when there is more than one container.
- While a filter hides lines, the Logs tab shows how many logs are visible out of the total, for example "12/200 logs", next to Clear all.
- Log search has a filter mode: All (the default) highlights matches without hiding any lines, Filtered shows only matching lines, and Invert shows only the others. Matches are always highlighted except in Invert, so the separate Highlight button and its H shortcut are gone.

### Fixed
