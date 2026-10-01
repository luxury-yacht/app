### Changed

- Copying or exporting a table with CPU or memory columns writes plain numbers: CPU in millicores and memory in KiB, with the unit in the column header. Spreadsheets can now sort and total these columns.
- The Resource Utilization section and the Cluster Overview workload usage show CPU and memory in the same units as the tables.
- Container logs load faster:
  - The first view appears within about 2 seconds, and a slow container no longer holds back the others.
  - Logs pick up where they left off when the connection drops, or the window is shown again.
  - Workloads with many containers, and pods that start while the tab is open, download far less history.
  - Lines of deleted pods are dropped. A StatefulSet pod recreated under the same name keeps its lines.
- Logs tab explains missing logs. Containers that cannot be read or have not started are listed, and dropped or trimmed lines are reported. When live logs stop for good, it shows why and turns auto-refresh off.
- Log source used to have a combined dropdown for Pods and Containers. This was confusing to use. It has been split into two separate dropdowns.
- Log settings moved to a new Logs section in Settings. Logs now keep 5,000 lines by default instead of 1,000. That buffer size remains configurable in Settings -> Logs.

### Fixed

- Sorting pods, workloads, and nodes by memory or CPU uses exact values. Pods just under 1 GiB no longer sort above larger ones.
- Fixed a regression that broke the Copy buttons and menu items.
- Logs tab reliability:
  - Pods that start while the tab is open stream and appear in the Pods dropdown right away. Scaling up no longer blanks the tab.
  - Live logs no longer stall, report history as dropped, hang on "Loading logs...", or stop on a very long line. Lines written at the same instant keep their order and are no longer dropped.
  - The tab stays responsive with large buffers.
  - Previous Logs and auto-refresh stay available when live logs cannot start.
  - A CronJob whose pods cannot all be listed no longer hides some of their logs.
  - Lines that start with bracketed text show the correct pod and container.
- Node logs load again on clusters that answered with a 406 error.
- Diagnostics summary cards describe only the active cluster.
- Settings fields are labelled for screen readers, and clicking a setting's title focuses its field.
