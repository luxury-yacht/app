### Changed

- **Container logs** load faster and download less:
  - The first view appears within about 2 seconds, and a slow container no longer holds back the others.
  - Logs pick up where they left off when the window is shown again, the connection drops, or auto-refresh is turned back on.
  - Workloads with many containers, and pods that start while the tab is open, download far less history.
  - Lines of deleted pods are dropped. A StatefulSet pod recreated under the same name keeps its lines.
- **Logs tab** explains missing logs: containers that cannot be read or have not started are listed, and dropped or trimmed lines are reported. When live logs stop for good, it shows why and turns auto-refresh off.
- **Log sources** are chosen with two dropdowns, Pods and Containers, each with All and None. A ReplicaSet lists all its pods, like a Deployment.
- **Node logs** look and behave like container logs, including the shared buffer limit.
- **Log settings** moved to a new Logs section in Settings. Logs now keep 5,000 lines by default.

### Fixed

- **Copy buttons and menu items** work again, for logs, table rows, error details, Details values, YAML and shell text.
- **Logs tab** reliability:
  - Pods that start while the tab is open, including init, recreated and debug containers, stream and appear in the Pods dropdown right away. Scaling up no longer blanks the tab.
  - Live logs no longer stall, report history as dropped, hang on "Loading logs...", or stop on a very long line. Lines written at the same instant keep their order and are no longer dropped.
  - The tab stays responsive with large buffers (about ten times faster at 10,000 lines).
  - Previous Logs and auto-refresh stay available when live logs cannot start, and the tab appears for pods whose logs you may read by name.
  - A CronJob whose pods cannot all be listed no longer hides some of their logs.
  - Lines that start with bracketed text show the right pod and container.
- **Node logs** load again on clusters that answered with a 406 error.
- **Diagnostics** summary cards describe only the active cluster.
- **Settings** fields are labelled for screen readers, and clicking a setting's title focuses its field.
