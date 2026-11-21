### Added

- **Workspaces.** Save the arrangement of app windows and panels under a name to reopen it later.
  - File → Open Workspace… (⇧⌘O / Ctrl+Shift+O), Save Workspace…, and Manage Workspaces…, or the same commands in the Command Palette, which also lists the saved workspaces in its Workspaces section.
  - A workspace keeps each window's position and maximized, minimized, or fullscreen state, along with its cluster tabs, views, table filters, and docked and floating panels.
    - In Linux Wayland, window position is decided by the compositor, so positions will not be saved as part of the workspace.
  - Opening a workspace replaces the current windows. Unsaved edits block the switch, and saved clusters that are no longer available are listed.
  - Saved workspaces can be replaced, renamed, or deleted from Manage Workspaces.

- **Command Palette improvements**
  - Ranked results. The best match comes first instead of using the predefined order.
  - Improved search. Every word must match, in any order, for commands and cluster objects. Extra spaces no longer hide results, and words also match an object's kind. Browse and the Diff Objects picker get the same multi-word search.
  - Words that match kinds like pod, svc, or deploy are highlighted in the search box, with the kind they filter to shown on the right.
  - Added a tooltip icon beside the search box to explain how search works.
  - Kubeconfigs section renamed to Clusters. Added a new Favorite Clusters group.
  - Clicking outside the palette closes it without also clicking what's underneath.
  - The Command Palette now stays inside the window at any zoom level.

- **API Resources.** A new cluster view, above Browse, lists every kind the cluster serves, built-in and custom, like `kubectl api-resources`.
  - Shows each kind's name, short names, API version, and scope, with filters for built-in or custom and for scope. Search also matches short names and API groups.
  - Opening a kind shows its details and a new Explain tab: the kind's fields as a tree, with the `kubectl explain` description of the field you select.
  - Custom kinds open their CustomResourceDefinition, which gains the same Explain tab.
  - The separate CRDs view is removed; custom resource definitions are now listed here.
