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
- Improved Details tab for PodDisruptionBudgets.
- Columns dropdown menu changed to an icon to save space and reduce visual clutter. Functionality is the same.

### Fixed

- Paste from clipboard into a shell session no longer prompts with a context menu to confirm the paste.
