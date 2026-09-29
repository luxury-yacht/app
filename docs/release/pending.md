### Changed

- Consistent styling in all dropdowns across the entire app, with clearer filter labels on multi-select dropdowns.
- A Namespaces filter selection made in an All Namespaces view now carries over to the other All Namespaces views for that cluster.
- Set consistent default column order across tables. Namespace now always follows Name, and Status comes after identity columns.

- Container logs load faster: each container's history and live output come from one request, the first view appears within about 2 seconds, and a slow container no longer holds back the others.
- The Logs tab now says why logs are missing: containers that cannot be read or have not started are listed, and dropped or trimmed lines are reported instead of disappearing silently.
- When live logs stop for good (for example, the workload was deleted or you may not list pods), the Logs tab shows the reason and turns auto-refresh off; turning it back on retries.
- Node logs now work like container logs: the same loading, error and empty states, the same Logs buffer limit, and the same warning icon beside the toolbar when older lines were dropped. The match count now reads "n matching logs".

### Fixed

- Node logs load again on clusters where the Logs tab said "Logs are not available on this node" with a 406 error.
- Auto-sized table columns no longer truncate their headers when the header is wider than the column's values.
- Container logs no longer show "Loading logs..." forever after an error.
- Live container logs now follow pods that start later, including their init containers, a pod recreated with the same name, and newly added debug containers.
- A very long log line no longer stops a container's live logs.
- Log lines written in the same instant keep their order, and identical lines are no longer dropped.
- The Logs tab now appears for pods whose logs you are allowed to read by name.
- A container log line whose message starts with bracketed text, such as `[main/INFO]`, no longer shows the wrong pod or container name, and clicking the name filters to the line's own pod or container.
