This release is focused on bugfixes, UI/UX, and code refactoring for stability and performance. There are no headline new features, but there are many minor quality-of-life improvements.

### Changed

- Better live feedback when editing YAML, and new conflict resolution options.
  - When there are conflicts, a new warning panel gives you options for resolving them. If someone else changes a field in the object you're currently editing, you choose whether to keep your edit or theirs.
  - If the object is deleted and recreated while you edit, you can copy your draft and start editing the new object.
  - The Save and Cancel buttons light up when you have unsaved edits.
- Data refresh improvements
  - Object panels in near-realtime, instead of every 2 to 5 seconds.
  - "Refresh background clusters" setting is removed because it's no longer needed. Switching in a background cluster shows the last data immediately, and updates in about a second.
  - Refresh (Cmd+R, or Ctrl+R on Windows and Linux) reloads everything on screen for the current cluster, including open panels and sidebar badges.
  - Panels in their own window properly refresh like the main window.
  - The "refreshing" indicator appears only when you ask for a manual refresh.
  - Gateway API, HPA, CRD, and Helm tables update as soon as something changes, and no longer reload every 15 seconds when nothing has changed.
  - A workload's Pods list drops a pod as soon as the pod stops belonging to that workload.
- The app uses less memory on clusters with many pods or events.
- Scrollbars are wider and higher-contrast. They appear only while you scroll or hover over the scroll area, and fade out shortly after.
- A new `partial` chip in the filter bar for data views shows when a table has incomplete data, such as namespaces you cannot read, a kind you cannot list, or an approximate count. Hover over it for details.
- Pods lists you expand under Nodes or Workloads rows stay expanded when you switch to another view, namespace, or cluster tab and come back. They reset when you close the cluster.

### Fixed

- Tables and Browse:
  - A table or Browse view with a saved search loads filtered rows right away, instead of briefly showing every row.
  - A favorite saved with no sort opens unsorted and stays selected.
  - Browse shows a page's load error in the table, and reads each page once when you sort, filter, or page.
  - Browse lists objects in namespaces where you can list them but not watch them.
  - Namespace, node drain, and catalog diff lists no longer redraw unchanged rows on each refresh.
  - Closing the Pods list under a node or workload keeps that row highlighted.
- Object panels:
  - A node or service opened from a link has the same context menu actions as one opened from its table.
  - A ReplicaSet opened from its Deployment lists its pods.
  - A custom resource whose kind name matches a built-in kind no longer gets the built-in kind's Pods, Jobs, Logs, or Shell tab, or its short name.
  - Object Map properly handles objects with names containing `?`, which `Role` and `ClusterRole` allow.
  - Object Map context menus show every action you are allowed to take, such as Delete on custom resources and Scale on the object map.
  - A panel you open or move into a window takes keyboard focus.
  - A Logs tab on a workload with many pods picks up new or changed pods much sooner.
  - The "HPA managed" flag no longer says "not managed" while HPA data is still loading or not readable.
- Object links:
  - Alt+click goes to the view that lists the object, such as Config for storage classes and Quotas for pod disruption budgets. Built-in kinds without their own list, such as ReplicaSets and Leases, go to Browse, and custom resources go to the Custom view.
  - Opening an object whose cluster is not open in the window says so.
  - A panel opened from a link to another cluster's object shows that cluster's name.
- YAML editor:
  - The Cancel button in the "Take ownership of managed fields?" dialog is visible in dark mode.
- Clusters and access:
  - Clusters whose kubeconfig file name or context name contains a comma now load.
  - Identities limited to some namespaces can see HPAs, Events, and Helm releases there, instead of "Insufficient permissions".
  - A namespace's warning-event count shows as unavailable when you cannot read its Events, instead of zero.
  - Reopening a cluster whose data still fails to load shows the error again.
  - Closing a cluster and reopening it right away no longer leaves its tables stuck loading.
  - A namespace list that fails to load shows one error instead of two.
- The Helm view no longer gets stuck showing `pending-install` or `pending-upgrade`.
- Clicking a recent warning on the cluster Overview opens its object on the Events tab again.
- Settings:
  - Importing settings that cannot be read back reports a failure and keeps your current settings. Before, it reset every setting to its default, including turning error reporting off.
  - Advanced and Object Panel settings show the saved value while Settings is open. A failed save goes back to the saved value, and changes made in another window appear.
  - Invalid values in a hand-edited or older settings file are repaired when the app loads.
- Windows and menus:
  - Closing the app window that a floating panel is docking into no longer freezes the panel window for up to 15 seconds.
  - While a window is closing, the macOS menu no longer opens Settings, the command palette, or other views in it.
  - The Diagnostics panel stays open when you switch cluster tabs.
- Command palette:
  - Cmd+Shift+N (Ctrl+Shift+N on Windows and Linux) switches an open palette to namespace selection.
  - Shortcuts show ⌘ only on macOS.
- Diagnostics no longer counts a stream's first connection as a resync.
