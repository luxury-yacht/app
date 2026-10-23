### Added

### Changed

- Refresh:
  - Cluster tabs you are not looking at no longer refresh in the background. A tab's data refreshes when you return to it.
  - The "Refresh background clusters" setting is removed.
- YAML editing:
  - While you edit, the YAML tab now shows when the object is modified outside the editor: a table lists each changed field, with its original value, the external edit, and your edit. Status-only updates are ignored.
  - When a field you edited was also changed outside the editor, you pick the external edit or your edit in that field's row before saving, so no change is overwritten by accident. You can change your pick, and "Merge changes and continue editing" brings in the other external changes either way.
  - If the object is deleted and recreated while you edit, you can copy your draft and start editing the new object.
  - Save turns green and Cancel turns red while you have unsaved edits.
- Scrollbar tweaks. They are wider and higher-contrast. They appear only while scrolling or when the pointer is over the scroll area, and fade out shortly after scrolling stops.
- A table showing partial data, such as namespaces missing from a cluster, a kind you cannot list, or an approximate count, now shows a Partial chip in its filter bar. Hover over it for the details. Before, this showed only in the result count's tooltip, and only while a filter was active.

### Fixed

- YAML editing:
  - In dark mode, the Cancel button in the "Take ownership of managed fields?" dialog was nearly invisible. It now uses the standard button style.
  - Merging the latest object into your draft no longer fails when someone else changed a field you did not edit, such as the replica count. For custom resources, it no longer undoes that change.
- Clicking a recent warning on the cluster Overview opens its object on the Events tab again. Before, the panel opened on Details.
- Object action menus offer every action you are allowed to take. Before, a custom resource's panel could leave out Delete, and the object map could leave out Scale, until something else had loaded those permissions.
- Importing settings now reports a failure when the imported settings cannot be read back, and keeps your current settings. Before, it said the import succeeded and reset every setting to its default, including turning error reporting off.
- Closing the pods listed under a node or workload with their Close button keeps that row highlighted. Before, the highlight cleared.
- Reopening a cluster whose data still fails to load shows the error again. Before, the error showed only the first time the cluster was open.
- A namespace list that fails to load shows one error. Before, it showed two.
- Browse:
  - A page that fails to load now shows its error in the table as well as in the error notice. Before, only the notice appeared and the table looked loaded.
  - Sorting, filtering, or paging reads the new page once. Before, each change read it twice.
- Command palette:
  - Cmd+Shift+N (Ctrl+Shift+N on Windows and Linux) switches an open palette to namespace selection. Before, it did nothing while the palette was open.
  - Shortcuts show ⌘ only on macOS. Windows and Linux show Ctrl and Shift.
- While a window is closing, the macOS menu no longer opens Settings, the command palette, or other views in it.
- Namespace, node drain, and catalog diff lists no longer redraw unchanged rows on each refresh.
- Diagnostics no longer counts a stream's first connection as a resync.
- A panel you open or move into a window now always takes keyboard focus. Before, it could stay unfocused when its contents loaded slowly.
- A table or Browse view with a saved search now loads filtered rows. Before, it briefly showed every row first.
- Opening a favorite saved with no sort shows its table unsorted, and the favorite stays selected. Before, the table came back sorted by name and the favorite looked unsaved.
- Object links:
  - Alt+click now goes to the view that lists the object. Storage classes, ingress classes, and webhook configurations open the cluster Config view, and pod disruption budgets open Quotas. Custom resources open the Custom view, even when their kind name matches a built-in kind, and built-in kinds with no list (such as Leases) open Browse. Before, some of these went to the wrong view or did nothing.
  - Opening an object whose cluster is not open in the window now says so. Before, nothing happened.
  - A panel opened from a link to an object in another cluster now shows that cluster's name.

- The Diagnostics panel no longer closes when you switch cluster tabs.
- Closing the app window a floating panel is docking into no longer leaves that panel window unresponsive for up to 15 seconds.
- Clusters whose kubeconfig file name or context name contains a comma now load. Before, the app read the comma as separating two clusters and loaded nothing for that cluster.
- The object panel's Map tab now shows the right object when the object's name contains `?`, which Role and ClusterRole names allow. Before, it looked up a different object.
- Tables:
  - Gateway API resources, HPAs, CRDs, and Helm releases update in their tables as soon as they change. Before, a table could keep the old rows until the next change.
  - Those tables no longer refetch every 15 seconds when nothing has changed.
  - A workload's Pods list drops a pod as soon as the pod stops belonging to that workload.
