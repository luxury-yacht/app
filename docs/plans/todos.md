# TODO

- Make the All Logs selector summary smarter.
  Right now multi-select can get opaque quickly. Summaries like 2 pods, 1 init container, 3 containers are better than long label lists.
- Add a visible active-filters strip under the toolbar.
  Show chips for:
  - text filter
  - invert
  - regex
  - case-sensitive
  - selected pods
  - selected init containers
  - selected containers
    This makes it much easier to understand why logs are missing.
- Show inline regex validation.
  If regex mode is on and the pattern is invalid, show that directly next to the filter input instead of only behaving like “no matches”.
- Distinguish empty states more clearly.
  There are several different situations:
  - no logs yet
  - no previous logs found
  - no logs match filters
  - logs unavailable due to backend/runtime conditions
    These should stay visually distinct.
- Make previous-logs mode more visually obvious.
  A small mode badge like Previous logs near the toolbar would help, because it is easy to forget you are not looking at live logs anymore.
- Improve parsed-view column defaults.
  The current parsed table is useful, but it would be better if:
  - msg or message got a larger default width/autosize cap
  - metadata columns stayed narrow
  - timestamp/pod/container stayed pinned left if the table supports it
- Add quick filter actions from the log rows.
  Examples:
  - click pod name to filter to that pod
  - click container name to filter to that container
  - maybe context menu: show only this pod, show only this container, exclude this pod
    That would make the logs tab feel much faster.
- Add a one-click Clear all filters.
  Right now filter state can accumulate across text, toggles, and dropdown selections.
- Keep toolbar toggle semantics extremely consistent.
  The search toggles should always follow one rule:
  - disabled only when logically incompatible
  - never silently no-op
  - if one toggle disables another, the UI should make that obvious
- Add better truncation cues in parsed view.
  If a cell is ellipsized, a hover title or expand affordance should always expose the full value without guesswork.

- Cursor turns to beam when dragging the app window in the header
- Center Mac icons in header

- Parsed logs, dropdown to hide fields

- can we get node logs?

- Allow remove of default kubeconfig path, if not the last

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
