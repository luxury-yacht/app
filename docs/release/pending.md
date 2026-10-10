### Changed

- Sidebar: Browse, Workloads, and the other built-in resource views now sit in the Resources group.
  - Only Overview, Attention, Events, and Identities (Cluster) and Events and Map (Namespace) stay at the top level.
  - Resources starts expanded on new installs. Existing installs keep their saved Resources state.
- Nodes: the Nodes view now has a Pods pane below the node list, like Workloads.
  - Click a node to see only its pods. With no node selected, the pane shows every pod in the cluster.
  - Existing Nodes favorites keep their settings.
- Pods view: a namespace Pods view is back, under Resources after Workloads, with every filter (Namespaces, Owner, Node).
  - "Go to Table View" on a pod, the Cluster Overview's ready-Pod count, and older Pods favorites open it.
- Pods pane (Workloads and Nodes): the selected row is now the pane's only filter.
  - The Namespaces, Owner, and Node dropdowns are gone, and Owner filters saved in favorites are dropped.
  - The selection is not saved: leaving the view or opening a favorite shows every pod again.
  - The Clear selected button is gone from the Workloads toolbar. Click empty space below the rows to clear the selection.
- Improved Details tab for PodDisruptionBudgets.
- Columns dropdown menu changed to an icon to save space and reduce visual clutter. Functionality is the same.

### Fixed

- Error statuses such as CrashLoopBackOff, Failed, and NotReady show in red again, in tables and status chips.
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
