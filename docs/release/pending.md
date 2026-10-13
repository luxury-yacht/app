### Added

- Restored the dedicated Pods view.
- Shell sessions can be ended from the app.
  - A connected Shell tab shows the container and shell with an End Session button above the terminal.
  - Shell rows in the Sessions list have a Stop button, like port forwards.
- Node Shell: nodes have a Shell tab equivalent to `kubectl debug node/<name> --profile=sysadmin`.
  - Starts a privileged debug pod on the node in the `default` namespace, using your kubeconfig's credentials; RBAC and admission policies apply as they do for kubectl.
  - The node's filesystem is mounted at `/host`, and the pod uses the node's network, process, and IPC namespaces.
  - The debug pod is deleted when the session ends. If it can't be deleted, the session stays in the Sessions list with the error until ending it again succeeds.

### Changed

- Workloads and Nodes now embed a Pods table, containing the pods that are child objects of that workload or node. This replaces the pods pane that was fixed to the bottom of the window.
  - Click the row's Pods count or press Space to show or hide its pods.
  - The pods table has its own filters, sort, and columns. This is completely independent of the filter, sort, and column settings of the parent view.
- Sidebar Workloads moved into the Resources group.
- Application Logs now use the same layout and controls as container logs. Application logs buffer size increased from 1,000 to 10,000 logs.
- Error messages are based on what the backend reports, not on words in the message text.
  - A rejected request shows its specific reason instead of a generic "Invalid request" message.
  - A change that conflicts with another writer says the object changed and to refresh and try again.
  - An action the app offered but the cluster refused now shows a notification instead of failing silently.

### Fixed

- Application Logs and Diagnostics no longer show a Float button that did nothing.
- The object panel marks an object deleted only when that object is gone, not when a related lookup fails.
- Tables show "Insufficient permissions" only for real permission denials; a timeout on an RBAC resource no longer reads as one.
- Node Logs auto-refresh no longer fails on every refresh and reloads the whole log.
- Opening a shell session from the Sessions list no longer shows an error when that pod's panel is already open.
