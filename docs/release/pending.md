### Changed

- Sidebar: Workloads and the other built-in resource views now sit in the Resources group.
  - Only Overview, Attention, Browse, Events, and Identities (Cluster) and Browse, Events, and Map (Namespace) stay at the top level.
  - Resources starts expanded on new installs. Existing installs keep their saved Resources state.
- Pods view: a namespace Pods view is back, under Resources after Workloads, with every filter (Namespaces, Owner, Node).
  - "Go to Table View" on a pod, the Cluster Overview's ready-Pod count, and older Pods favorites open it.
- Workloads and Nodes: a row's pods now open in their own table right under that row, replacing the Pods pane below Workloads.
  - Click a row's Pods count, shown as `2/3 ›`, or press Space to open or close its pods. The pods table also has a Close button at the right end of its toolbar. The Workloads Ready column is now called Pods. A plain click only highlights the row; Enter still opens the object.
  - The pods table has its own filter, sort, and columns, starting fresh each time it opens. It has no Namespaces, Owner, or Node dropdowns, and never changes the Workloads or Nodes table.
  - It skips the column that would repeat its row: no Owner column under a workload, no Node column under a node.
  - The Clear selected button is gone from the Workloads toolbar. Click empty space below the rows to clear the highlight.
- Favorites save one table: the view's own. Favorites saved with the Workloads Pods pane keep only their Workloads settings.
- Application Logs work like a pod's Logs tab:
  - A Stop/Start auto-refresh button (or `R`) replaces the auto-scroll toggle.
  - New lines follow at the bottom. Scroll up to hold your place, then Resume scrolling.
  - They keep the newest 10,000 lines instead of 1,000. This is fixed, separate from the Logs tabs' Buffer size setting.
  - They are a table like the others: columns size to their content and can be resized, and a click on a row (or Enter) expands it to show a long message in full.
  - Only the rows in view are drawn, and new lines arrive at most four times a second, so a busy or full log stays responsive.
- Improved Details tab for PodDisruptionBudgets.
- Columns dropdown menu changed to an icon to save space and reduce visual clutter. Functionality is the same.

### Fixed

- Error statuses such as CrashLoopBackOff, Failed, and NotReady show in red again, in tables and status chips.
- Application Logs show the cluster name instead of `<kubeconfig file>:<context>`, including on lines logged before a cluster finishes connecting.
- Connecting a cluster no longer logs "Cannot rebuild subsystem … clients not found" warnings.
- Application Logs and Diagnostics no longer show a Float button that did nothing. Only object panels can float, so a panel group that includes either one stays docked.
- Styling fixes:
  - Invalid fields in dialogs show a red outline and red error text.
  - Dropdown options highlight on hover in light mode.
  - Binary values in the Details tab use the theme's warning colors instead of a cream box in dark mode.
  - Hovering a selected table row no longer tints it amber in light mode.
  - App Logs and the cluster authentication failure reason use a monospace font.
  - Help text and hints in Settings and dialogs use the smaller secondary text size.
  - Header buttons, the sidebar toggle, and Details tab values highlight on hover.
  - Cluster Overview node links use the link color.
- Tables with 25 or fewer rows no longer show pagination controls when some of their data is unavailable (for example, a resource type you can't list).
- Paste from clipboard into a shell session no longer prompts with a context menu to confirm the paste.
