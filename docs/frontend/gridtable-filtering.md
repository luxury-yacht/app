# GridTable Filtering

Read for filter controls, query facets, search, cross-view filter requests,
or favorite snapshots. Apply the [shared contract](gridtable.md). Dropdown
placement and zoom follow [interaction boundaries](gridtable-interaction.md#interaction-boundaries).

## Filter controls and navigation

- Filter inputs and pagination dropdowns are interaction contracts, not just
  rendering details. Changes to them need tests proving controlled search keeps
  focus across updates and rows-per-page menus open and dispatch supported
  values.
- Filter-bar `Tab` and `Shift+Tab` navigation follows the rendered control
  order. Provider query facets participate in that order alongside structural
  filters, search, actions, and Columns; adding a facet must not create a
  keyboard focus trap.
- Every table has one icon bar after the search box, in this order: Include
  metadata, the view's own icons (`viewActions`, such as Clear selected workload
  or Manage ignored findings), Favorite, a separator, and Download. Include
  metadata shows on tables whose rows carry labels and annotations, except the
  catalog-backed Browse and custom views; Favorite shows on main-window views
  only. Query-backed tables search the metadata in the backend: per-build
  domains through the typed matcher, maintained stores through the paged
  store's `MetadataText`. The one
  exception is a pane's structural control: it uses `beforeNamespaceActions`,
  which GridTable renders as its own icon bar after Kind and before Namespace.
  The Workloads/Pods composite uses it for the Pods pane's collapse control,
  which the Pods pane (no Kind filter) shows as its leftmost control.
- Search ignores letter case on every table, local and query-backed; there is
  no case-sensitive option. Saved table state and favorites that still carry the
  old `caseSensitive` flag load normally and drop it.
- The Download button's menu (`useGridTableDownloadAction`, on the shared
  `@shared/hooks/useDownloadMenu` that log views also use) copies the rows to
  the clipboard as CSV or saves them to a CSV file. It is busy while a choice
  runs, then flashes success or error; a canceled save changes nothing. Both take every matching row
  when the view supplies `fetchAllRows`, and otherwise the local filtered rows.
  Its label says "all matching rows" unless the rows are a backend page without
  `fetchAllRows` or a partial window (`partialDataLabel`), which say "visible
  rows".
- Every multi-select Kinds dropdown exposes search plus `Select all` and
  `Select none`. GridTable owns this as an invariant of a visible Kind filter;
  views may decide whether the filter is present but cannot disable its controls.
- Filter-style multiselects use three explicit states: `all` is unrestricted
  and includes options discovered later, `some` matches only its stored values,
  and `none` matches no rows. Controlled Dropdown values project `all` to every
  current option and `none` to an empty selection. Query adapters serialize
  `none` as `matchNone=true`; they may remove a full-dimension `all` selection
  only when building an equivalent backend query and must not write that query
  optimization back into dropdown state. The Columns dropdown is intentionally
  different: its selected values are enabled columns, so none hides every
  hideable column.
- Non-default GridTable filters render as removable chips beneath the filter
  controls, with one `Clear all` action that uses the table's existing reset
  contract. The filter-bar icon group does not duplicate that action with a
  reset button. Search and boolean filters use descriptive labels. A multiselect
  containing exactly one value uses the singular filter type and selected
  option label, such as `Namespace: kube-system`; if that option is no longer
  available, the stored value is the label fallback. Zero or multiple selected
  values use the plural filter type and count, such as `Namespaces: 0` or
  `Statuses: 2`. Chip visibility and counts come from the stored selection mode:
  `all` renders no chip, `some` renders its stored value count, and `none`
  renders zero. Removing a multiselect chip restores that dimension to `all`;
  it must not synthesize a selection from the currently available options. When
  a narrowing filter is active, the same row begins with plain
  `Showing N of M items` summary text before `Clear all`.
- Query facets may declare `placement: 'before-kinds'` when they constrain the
  Kind vocabulary. They must also declare `invalidates: ['kinds']` so changing
  the upstream facet clears the previous Kind selection in the same state
  transition; the provider then supplies the dependent Kind options.
- Query-backed filter feedback displays the backend's filtered total against the
  unfiltered total for the same view scope. Producers must not widen the
  denominator beyond cluster-scoped, all-namespaces, or pinned-namespace
  boundaries when clearing user filters.
- Cross-view filter navigation uses the shared one-shot GridTable filter request.
  Every request must name the exact destination `viewId` and `clusterId`; the
  destination applies it only after its persisted table state hydrates, then
  consumes it. Stage the request before activating the destination route so
  another table or cluster cannot receive it and hydration cannot overwrite it.

## Filtering And Search

- Use local search only when the table owns the complete searchable row set.
- Use query-backed search when upstream query parameters shape the dataset.
- Namespace filters must preserve cluster-scoped resources where the table
  includes them.
- All Namespaces tables that show the Namespaces filter share one selection per
  cluster, so a selection follows the user between All Namespaces views.
  `useGridTablePersistence({ shareNamespaceFilter })` keeps it in the cluster's
  `shared-namespace-filter` entry, saved immediately rather than debounced
  because navigation unmounts the table; the table's own entry stores its other
  filters with Namespaces at `all`. The Workloads route's Pods pane opts out
  because workload selection rewrites its Namespaces filter. Single-namespace and
  cluster views never read the shared selection.
- Multi-cluster local tables use the first-class Cluster filter. Dropdown option
  values and row accessors carry `clusterId`; context names are display labels
  only. Build the option vocabulary from the table's full open-cluster scope so
  partial row availability does not rename, collapse, or remove cluster
  selections. Cluster selections persist with GridTable state and favorites.
- Metadata filters that describe the object universe should come from catalog or
  query metadata, not a capped row slice.
- Query providers may add `queryFacets` to the shared filter state and options.
  Each facet uses a stable provider-owned key, persists through GridTable state
  and favorites, and only shapes backend queries; GridTable must not locally
  apply those selections to the current page.
- Provider-specific facets are declared by backend capability descriptors and
  paired by key with envelope `facetValues`. The shared resource-query adapter
  maps descriptor labels/placeholders/searchability/bulk actions and option
  value/labels into GridTable controls, and serializes selections as repeated
  `facet.<key>` query values. Each value is opaque and must never be comma-split
  because providers may use structured identities containing commas. Views must
  not add key-specific projection or serializer branches.
- A query-backed view may exclude provider facets from its filter bar through
  the shared query wrapper. Exclusion removes both the control and that facet's
  active query state; filtering only the rendered controls would leave an
  invisible persisted filter affecting results.
- A provider may publish a facet only after request serialization, backend
  extraction/filtering, full-structural-scope options, UI projection, and shared
  persistence exist. Do not advertise status, owner, node, application, or other
  row-field filters from response facets alone.
- Pods, Workloads, and Nodes are the reference typed-query facet implementations:
  their provider-owned options describe the full structural scope, remain stable
  when a selection narrows the result set, and feed backend query parameters
  through the shared typed-resource scope builder. Their providers publish
  Status, but the user-facing tables exclude it. Pods expose Owner followed by
  Node; in all-namespaces views those controls follow Namespace. Workloads row
  selection writes Namespace and Owner through the same controlled filter state
  used by direct dropdown interaction.

### Favorite snapshots

- A favorite is a main-window route (cluster, view tab, namespace) plus its
  tables' state. Every main-window table view offers exactly one favorite
  action; tables inside an object panel offer none, in the main window as in a
  panel window, because the route they would save is not theirs.
- A favorite snapshots the complete `GridTableFilterState` and table display
  state as one named pane. Favorites code must compare, edit, save, and restore
  the state object as a whole; it must not maintain a separate allowlist of
  Kinds, Namespaces, or provider facet keys.
- Table display state includes column order as well as sort and visibility.
  Restoring a favorite reconciles the saved order with the current definitions:
  removed keys are dropped and newly added columns append in declaration order.
- The save modal derives editable controls from the pane's
  `GridTableFilterOptions`. Built-in structural filters and every declared
  `queryFacets` entry therefore use the same option vocabulary and selection
  semantics as the live table. Every favorite multi-select must expose the
  semantic `all` selection and persist it as `mode: all`, never as a snapshot
  of the option values that happened to exist when the favorite was saved. Its
  closed control displays `All` for `mode: all` and `None` for `mode: none`;
  `mode: some` displays the stored value count as `n selected` instead of
  listing the selected option labels.
- A route with multiple tables stores one favorite containing a named snapshot
  for every pane. The Workloads route owns `workloads` and `pods`; it exposes one
  favorite action, waits for both persistence stores to hydrate, then restores
  both panes before consuming the pending favorite.
- Favorites schema v3 stores named panes exclusively. The backend migrates v1
  and v2 entries individually, retaining valid entries when another entry is
  malformed. Legacy Workloads and Pods favorites become the combined Workloads
  route with both named panes; the unrecorded pane receives its defaults. The
  migrated collection is saved as v3. A newer, unsupported schema fails to load.
