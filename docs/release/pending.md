### Changed

- Container logs load faster: the first view appears within about 2 seconds, and a slow container no longer holds back the others.
- The Logs tab now says why logs are missing: containers that cannot be read or have not started are listed, and dropped or trimmed lines are reported instead of disappearing silently.
- When live logs stop for good (for example, the workload was deleted or you may not list pods), the Logs tab shows the reason and turns auto-refresh off; turning it back on retries.
- Node logs now work like container logs: the same loading, error and empty states, the same Logs buffer limit, and the same warning icon beside the toolbar when older lines were dropped. The match count now reads "n matching logs".
- Log settings moved from the gear in the Logs tab to a new Logs section in Settings, and "Object Panel Logs Tab buffer size" is now "Buffer size".
- Container logs pick up where they left off when the app window is shown again, the connection drops, or auto-refresh is turned back on, instead of downloading every container's history again.
- Opening container logs for a workload with many containers downloads far less: about one buffer of history in total instead of one buffer per container.
- Pods that start while a Logs tab is open download less: they read nothing older than the tab can still show, and pods starting together share one buffer of history.
- The Logs tab drops the lines of pods that were deleted, whether while the tab was open or while it was hidden, so they no longer take up room in the buffer. A StatefulSet pod recreated under the same name keeps its earlier lines.
- The Logs tab's source dropdown is now two dropdowns, Pods and Containers, each with its own All and None.
- Logs tabs now keep 5,000 lines by default instead of 1,000. A Buffer size you have already saved in Settings → Logs is kept.

### Fixed

- A pod that starts while a workload's Logs tab is open is no longer hidden for up to 15 seconds while the workload's details catch up, and a CronJob whose pods could not all be listed no longer hides some of their logs.
- A pod that starts while a Logs tab is open appears in the Pods dropdown as soon as its lines do, instead of up to several seconds later.
- Scaling up a workload no longer blanks its Logs tab for a few seconds; a new pod's lines show as soon as they arrive.
- The Diagnostics panel's summary cards describe the active cluster only. The Logs and Events cards often showed 0 or a single tab's or scope's count, and the Events and Metrics cards showed the first open cluster instead of the one you were viewing.
- The Logs tab stays responsive with large buffers: taking in new lines no longer slows down as the buffer grows (about ten times faster at 10,000 lines).
- When live container logs cannot start (for example, you may read a pod's logs but not list pods), the Logs tab keeps its controls, so Previous Logs and auto-refresh stay available.
- Live logs for a workload no longer stall when a pod is deleted just as the Logs tab opens; its replacement streams.
- Opening logs for a workload with many containers no longer reports history as "dropped because the log view fell behind", and the first view always shows the newest lines.
- Node logs load again on clusters where the Logs tab said "Logs are not available on this node" with a 406 error.
- Container logs no longer show "Loading logs..." forever after an error.
- Live container logs now follow pods that start later, including their init containers, a pod recreated with the same name, and newly added debug containers.
- A very long log line no longer stops a container's live logs.
- Log lines written in the same instant keep their order, and identical lines are no longer dropped.
- The Logs tab now appears for pods whose logs you are allowed to read by name.
- A container log line whose message starts with bracketed text, such as `[main/INFO]`, no longer shows the wrong pod or container name, and clicking the name filters to the line's own pod or container.
