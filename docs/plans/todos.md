# TODO

## Favorites

- Create a Storybook story for this modal. Make sure it uses the actual code so that changes visible in the storybook are real.
- When clicking the Favorite button in the view, use a modal instead of a dropdown menu.
- Reuse the existing Modal component and styles
- Modal should show:
  - `Name` as text field to change the name, prepopulated with the default
  - `Type`
    - Radio buttons to select `Cluster-specific` or `Any Cluster`
  - `Cluster` (shows cluster name or Any)
    - Dropdown whose contents are derived from all available clusters (not just the ones that are open)
  - `Scope`
    - Radio buttons to select Cluster or Namespaced
  - `View` (shows the View name)
    - Dropdown, populate this based on the value of the Scope dropdown
  - `Namespace` (only visible when Scope is Namespaced)
    - Dropdown, populate with all available namespaces, including `All Namespaces` at the top of the list
  - `Filters`
    - `Filter Text`
      - Editable text field
    - `Case-Sensitive` and `Include Metadata`
      - Editable checkboxes
  - Delete, Save, and Cancel buttons
    - When editing, only enable the Save button when changes are made.
    - Show a secondary confirmation modal for Delete.

## Other

- Preemptive permissions check - start as soon as the view is opened, don't wait for right-click

- Resource creation
  - starter templates for common resource types
  - reuse the existing code editor

## Issues

- Large cluster pagination — views other than Browse (e.g. Pods) load all items in one request. On clusters with thousands of resources this could be slow. Consider adding pagination/Load More to all grid table views.

## Feature Ideas

- Gridtable improvements
  - Allow column order change via drag
    - should reset button also reset to default column order?
      - probably not because that reset is for filters
  - Pods view, change default column order to Name, Owner, Namespace

- Transfer files to/from pods
  - Select container
  - can we show a file dialog for the remote filesystem?

- More deployment options
  - Container scope:
    - set image
      - show a list of containers and their images, allow override
    - update resource requests/limits

- Metrics over time
  - Graphs instead of only point-in-time numbers
  - No persistence, just show metrics for the current view, drop them when the view changes

- Helm install/upgrade/delete
  - track deployments, offer rollbacks?

- Multi-select/batch operations
  - Allow batch operations, but could be dangerous

## Wails v3 (when ready)

- Multiple windows
  - Object Panel, logs, diagnostics in its own window

- Automatic app updates
