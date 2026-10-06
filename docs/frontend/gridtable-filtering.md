# GridTable Filtering

Filter controls, query facets, search, cross-view filter requests, and favorite
snapshots. Apply the [shared contract](gridtable.md). Dropdown placement and
zoom follow [interaction boundaries](gridtable-interaction.md#interaction-boundaries).

## Filter controls and navigation

- Filter-bar `Tab`/`Shift+Tab` follows rendered control order, provider facets
  included; adding a facet must not create a focus trap.
- One icon bar follows the search box, in order: Include metadata, the view's
  `viewActions` (such as Clear selected workload or Manage ignored findings), a
  separator, Favorite, a separator, Download. Favorite has no leading separator
  when it is first. Include metadata shows when rows carry labels and
  annotations (`supportsCustomMetadataColumns`), except catalog-backed Browse
  and custom views; local tables match metadata in `gridTableFilterEngine`,
  query-backed tables in the backend
  ([typed query contract](../architecture/large-data-query.md#typed-resource-query-contract)).
  Favorite shows on main-window views only.
- Exception: a pane's structural control uses `beforeNamespaceActions`, its own
  icon bar after Kind and before Namespace (the Pods pane's collapse control,
  leftmost because Pods has no Kind filter).
- Search ignores case on every table; there is no case-sensitive option. Saved
  state and favorites carrying the old `caseSensitive` flag load and drop it.
- Download (`useGridTableDownloadAction` on `@shared/hooks/useDownloadMenu`,
  shared with log views) copies or saves CSV: busy while running, then flashes
  success or error; a canceled save changes nothing. It takes every matching row
  when the view supplies `fetchAllRows`, otherwise the local filtered rows, and
  says "visible rows" instead of "all matching rows" for a backend page without
  `fetchAllRows` or a partial window (`partialDataLabel`).
- Every visible multi-select Kinds dropdown has search, `Select all`, and
  `Select none`; GridTable owns this, and views only decide whether it shows.
- Filter multiselects have three explicit states: `all` (unrestricted, includes
  options discovered later), `some` (stored values only), and `none` (matches
  no rows). Controlled Dropdown values project `all` to every current option and
  `none` to an empty selection. Query adapters serialize `none` as
  `matchNone=true` and may drop a full-dimension `all` only from the built
  backend query, never writing that optimization back into dropdown state. The
  Columns dropdown differs: its values are enabled columns, so none hides every
  hideable column.
- Non-default filters render as removable chips beneath the controls with one
  `Clear all` (the table's reset contract; no duplicate reset icon). Search and
  boolean chips use descriptive labels; a one-value multiselect shows the
  singular type and option label (`Namespace: kube-system`, or the stored value
  when the option is gone); zero or several show the plural type and count
  (`Namespaces: 0`, `Statuses: 2`). Chips follow the stored mode (`all`: none,
  `some`: count, `none`: zero). Removing a multiselect chip restores `all`, never
  a selection synthesized from current options. A narrowing filter prefixes the
  row with `Showing N of M items`.
- Query-backed filter feedback shows the backend's filtered total against the
  unfiltered total for the same view scope; producers never widen the
  denominator beyond cluster-scoped, all-namespaces, or pinned-namespace
  boundaries when clearing user filters.
- Cross-view filter navigation uses the shared one-shot GridTable filter
  request, naming the exact destination `viewId` and `clusterId`. Stage it
  before activating the destination route; the destination applies it only after
  its persisted state hydrates, then consumes it, so no other table or cluster
  receives it and hydration cannot overwrite it.

## Filtering And Search

- Search locally only when the table owns the complete searchable row set;
  otherwise use query-backed search ([table modes](../architecture/large-data.md#table-modes)).
- Namespace filters preserve cluster-scoped resources where the table includes
  them.
- All Namespaces tables showing the Namespaces filter share one selection per
  cluster: `useGridTablePersistence({ shareNamespaceFilter })` keeps it in the
  cluster's `shared-namespace-filter` entry, saved immediately rather than
  debounced because navigation unmounts the table; the table's own entry stores
  Namespaces as `all`. The Workloads route's Pods pane opts out because workload
  selection rewrites its Namespaces filter. Single-namespace and cluster views
  never read the shared selection.
- Multi-cluster local tables use the first-class Cluster filter: option values
  and row accessors carry `clusterId`; context names are display labels only.
  Build options from the table's full open-cluster scope so partial row
  availability never renames, collapses, or removes selections. Selections
  persist with table state and favorites.

### Query facets

- Providers add `queryFacets` to the shared filter state and options. Each facet
  has a stable provider-owned key, persists through table state and favorites,
  and only shapes backend queries; GridTable never applies it to the current
  page.
- Backend capability descriptors declare provider facets, paired by key with
  envelope `facetValues`. The shared resource-query adapter maps descriptor
  labels, placeholders, searchability, bulk actions, and option values/labels
  into GridTable controls, and serializes selections as repeated `facet.<key>`
  query values. Values are opaque and never comma-split, because structured
  identities may contain commas. Views add no key-specific projection or
  serializer branches, and a new facet needs no new GridTable state field.
- A facet with `placement: 'before-kinds'` constrains the Kind vocabulary and
  must declare `invalidates: ['kinds']`, so changing it clears the Kind selection
  in the same transition; the provider supplies the dependent Kind options.
- A view may exclude provider facets through the shared query wrapper. Exclusion
  removes both the control and its active query state; hiding only the control
  would leave an invisible persisted filter.
- Publish a facet only after request serialization, backend
  extraction/filtering, full-structural-scope options, UI projection, and shared
  persistence exist. Rejected: advertising status, owner, node, application, or
  other row-field filters from response facets alone.
- Pods, Workloads, and Nodes are the reference implementations: options describe
  the full structural scope, stay stable when a selection narrows the result,
  and feed the shared typed-resource scope builder. Their providers publish
  Status, but the user-facing tables exclude it. Pods show Owner then Node,
  after Namespace in all-namespaces views. Workloads row selection writes
  Namespace and Owner through the same controlled filter state as the
  dropdowns.

### Favorite snapshots

- A favorite is a main-window route (cluster, view tab, namespace) plus its
  tables' state. Every main-window table view offers exactly one favorite
  action; tables inside an object panel offer none, in either window, because
  the route they would save is not theirs.
- A favorite snapshots the complete `GridTableFilterState` and table display
  state (sort, visibility, column order) as one named pane. Favorites code
  compares, edits, saves, and restores that state as a whole, with no separate
  allowlist of Kinds, Namespaces, or provider facet keys. Restoring reconciles
  the saved order with current definitions: removed keys drop and newly added
  columns append in declaration order.
- The save modal derives editable controls from the pane's
  `GridTableFilterOptions`, so structural filters and every `queryFacets` entry
  use the live table's vocabulary and selection semantics. Every favorite
  multi-select exposes the semantic `all` selection and persists it as
  `mode: all`, never a snapshot of the options at save time. Its closed control
  shows `All` for `mode: all`, `None` for `mode: none`, and `n selected` for
  `mode: some`.
- A route with several tables stores one favorite with a named snapshot per
  pane; the Workloads route owns `workloads` and `pods` behind one favorite
  action (restore handoff: [navigation](navigation.md#favorites)).
- Favorites schema v3 stores named panes only. The backend migrates v1 and v2
  entries individually, keeping valid entries when another is malformed; legacy
  Workloads and Pods favorites become the combined Workloads route, with the
  unrecorded pane at defaults. The migrated collection saves as v3; a newer,
  unsupported schema fails to load.
