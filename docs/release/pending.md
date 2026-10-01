### Added

- The metrics status popover now shows how long ago metrics were last collected.

### Changed

- Exported table data is easier to import into spreadsheets. CPU and memory metrics now export as numbers only, with no unit indicators. CPU is exported in millicores, and memory is exported in KiB.
- An object's Events tab now has an Event link in its first column, and pressing Enter on the selected row opens the Event instead of the involved object; the Object Name link still opens the involved object.
- Clicking a row in Cluster Events no longer opens the Event, matching every other table; use the Event link or press Enter on the selected row.
- In the Events tables, an object's Events tab, and the Overview's Recent Events, an event with an empty type, source, or message now shows `-`, instead of `Normal`, `Unknown`, or a repeat of the reason.

### Fixed

- The All Namespaces Events view now updates as events change; it previously stayed on its first page of results until reopened.
- The Overview's Recent Events now include recurring warnings that started over 24 hours ago (recorded through the newer events API), and list them by when they were last seen.
- An object's Events tab now shows the most recent events when it has more than 500, and no longer hides events recorded against another version of the same API.
- Involved objects of events recorded without an API version now open through a lookup by UID in the Events tables, an object's Events tab, and the Overview's Recent Events; the app no longer guesses the API version from the object's kind.
- Events that expired while the app was closed, or while a cluster was idle, no longer linger in the Events tables after reconnecting.
- Action buttons in the connectivity and sessions status popovers are now readable in light mode, and have stronger contrast in dark mode.
