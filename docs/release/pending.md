### Changed

- Consistent styling in all dropdowns across the entire app, with clearer filter labels on multi-select dropdowns.
- A Namespaces filter selection made in an All Namespaces view now carries over to the other All Namespaces views for that cluster.
- Set consistent default column order across tables. Namespace now always follows Name, and Status comes after identity columns.

- Container logs load faster: the first view appears within about 2 seconds, and a slow container no longer holds back the others.
- The Logs tab now says why logs are missing: containers that cannot be read or have not started are listed, and dropped or trimmed lines are reported instead of disappearing silently.
- When live logs stop for good (for example, the workload was deleted or you may not list pods), the Logs tab shows the reason and turns auto-refresh off; turning it back on retries.
- Node logs now work like container logs: the same loading, error and empty states, the same Logs buffer limit, and the same warning icon beside the toolbar when older lines were dropped. The match count now reads "n matching logs".
- Log settings moved from the gear in the Logs tab to a new Logs section in Settings, and "Object Panel Logs Tab buffer size" is now "Buffer size".
- Container logs pick up where they left off when the app window is shown again, the connection drops, or auto-refresh is turned back on, instead of downloading every container's history again.
- Opening container logs for a workload with many containers downloads far less: about one buffer of history in total instead of one buffer per container.
- The Logs tab's source dropdown is now two dropdowns, Pods and Containers, each with its own All and None.

### Fixed

- Scaling up a workload no longer blanks its Logs tab for a few seconds; a new pod's lines show as soon as they arrive.
- The Logs card in the Diagnostics panel now counts lines delivered to every Logs tab; it often showed 0 or one tab's count.
- The Logs tab stays responsive with large buffers: taking in new lines no longer slows down as the buffer grows (about ten times faster at 10,000 lines).
- When live container logs cannot start (for example, you may read a pod's logs but not list pods), the Logs tab keeps its controls, so Previous Logs and auto-refresh stay available.
- Live logs for a workload no longer stall when a pod is deleted just as the Logs tab opens; its replacement streams.
- Opening logs for a workload with many containers no longer reports history as "dropped because the log view fell behind", and the first view always shows the newest lines.
- Node logs load again on clusters where the Logs tab said "Logs are not available on this node" with a 406 error.
- Auto-sized table columns no longer truncate their headers when the header is wider than the column's values.
- Container logs no longer show "Loading logs..." forever after an error.
- Live container logs now follow pods that start later, including their init containers, a pod recreated with the same name, and newly added debug containers.
- A very long log line no longer stops a container's live logs.
- Log lines written in the same instant keep their order, and identical lines are no longer dropped.
- The Logs tab now appears for pods whose logs you are allowed to read by name.
- A container log line whose message starts with bracketed text, such as `[main/INFO]`, no longer shows the wrong pod or container name, and clicking the name filters to the line's own pod or container.
