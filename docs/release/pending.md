### Changed

- Pods and Workloads:
  - Pods is its own view again, in the sidebar after Workloads. Going to a pod's table view and Cluster Overview's pod count open it.
  - Workloads is a single table. The Pods pane below it is gone.
  - New "Show Pods" toggle in the Workloads and Nodes tables, on by default. While it is on, clicking a workload or node row shows its pods in a Pods tab docked at the bottom, and highlights that row. The Kind badge and name still open the full panel. The setting is remembered for each table.
  - CronJobs have a Pods tab listing the pods of all their Jobs.
  - The Pods view and the Pods tab share one table, so their columns and actions match.
  - Saved Workloads favorites keep the Workloads table's filters. A favorite that only filtered the old Pods pane becomes a Pods view favorite.
- Improved Details tab for PodDisruptionBudgets.
- Columns dropdown menu changed to an icon to save space and reduce visual clutter. Functionality is the same.

### Fixed

- Paste from clipboard into a shell session no longer prompts with a context menu to confirm the paste.
