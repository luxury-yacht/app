# Large Data Architecture

Large data views in Luxury Yacht are designed around bounded rendering,
stable identity, explicit metadata sources, and diagnostics that explain what
kind of table is being measured.

See [README.md](README.md) for the architecture doc map.

## Product Model

The default table model is:

- capped result sets
- virtualization for large tables
- filters/search to narrow oversized views
- stable row identity across refresh, stream, sort, and filter changes
- measured performance diagnostics rather than guesswork

This model does not try to restore the older "always load the full active
dataset" approach.

Avoid numbered pages as the primary user interaction. Query-backed surfaces may
use explicit load-more or backend continue tokens when the domain owns that
contract, but ordinary typed tables should stay capped and encourage filtering
instead of unbounded loading.

## Current Mechanisms

Shared GridTable behavior:

- `maxTableRows` is a user setting with default `1000`, minimum `100`, and
  maximum `10000`.
- `GridTable` applies the cap after local filtering and before rendering.
- The filter bar shows `displayed of total` when the cap hides rows and tells
  users to narrow the result set or change the setting.
- Row virtualization is enabled by default with threshold `120`, overscan `6`,
  and estimated row height `44`.
- Column virtualization is available through `virtualization.columnWindow` for
  wide tables that opt into it.
- `GridTable` has a generic load-more API (`hasMore`, `onRequestMore`,
  `isRequestingMore`) for query-backed tables that explicitly wire paging.

Catalog/browse behavior:

- Browse scopes include `limit=<maxTableRows>`.
- Backend catalog queries default to `ObjectCatalogQueryLimit = 1000` and clamp
  caller-supplied limits to `ObjectCatalogMaxQueryLimit = 10000`.
- Catalog snapshots include `continue`, `total`, `batchIndex`, `batchSize`,
  `totalBatches`, and `isFinal` so query-backed consumers can reason about
  partial results.
- Browse derives kind/namespace filter metadata from catalog metadata, not from
  the currently displayed row slice.

Diagnostics behavior:

- GridTable diagnostics record `inputRows`, `sourceRows` (post-cap), and
  `displayedRows`.
- Diagnostics modes are `local`, `query`, and `live`; each mode changes how row
  count and reference churn signals should be interpreted.
- Diagnostics also record filter option cost, filter pass cost, sort cost,
  render cost, scroll frame timings, and broad replacement signals.

## Durable Rules

### Identity

Every Kubernetes object row must preserve canonical identity:

- `clusterId`
- `group`
- `version`
- `kind`
- `namespace`
- `name`

Use empty `namespace` for cluster-scoped objects. `uid` remains important for
lifecycle-sensitive workflows, but it is not the primary row key.

Use the catalog as the canonical source for object identity and existence. See
[catalog.md](catalog.md) and [shared-resource-model.md](shared-resource-model.md)
for the full identity contract.

### Metadata Sourcing

Metadata-driven controls must use explicit metadata sources where required:

- Catalog-backed browse filters should use catalog metadata.
- Typed views may use typed-domain metadata when the domain supplies it.
- Row-derived metadata is allowed only when it is deliberate, local to that
  table, and safe under caps.

Do not rebuild global filter/sidebar metadata from whatever rows happened to be
loaded most recently.

### Interaction Ownership

Table families must declare where search, filter, and sort truth lives:

- `local`: GridTable search/filter/sort operate on the loaded row set.
- `query`: upstream query/filtering shapes the result before it reaches the
  table.
- `live`: frequent row changes are expected because key fields are time-varying
  or stream-driven.

These modes are part of diagnostics semantics as well as UI interpretation.

### Diagnostics Semantics

Interpret performance diagnostics by table mode:

- `local`: broad input replacement is usually suspicious when the effective row
  set is unchanged.
- `query`: broad replacement can be normal when the upstream query changes, but
  is suspicious for stable queries.
- `live`: churn is expected; prioritize sort, render, and scroll-frame warnings
  before treating replacement as a feed bug.

## Performance Expectations

Large-data work should optimize for:

- stable row keys and row object reuse where practical
- bounded metadata derivation
- incremental update paths for live data
- explicit recomputation boundaries
- virtualized rows for large tables
- optional column virtualization for very wide tables
- capped display counts even when upstream data is much larger
- responsiveness during refresh and stream churn

Heavy live families such as Pods should be evaluated after shared table and
refresh groundwork is stable, not before it.

## Validation

Validate both real and synthetic data.

Minimum real-cluster surfaces:

- Cluster Browse
- All Namespaces Browse
- representative all-namespaces typed views
- representative cluster typed views
- heavy live views such as Pods, Workloads, Nodes, and Events

Synthetic targets should probe upstream/input sizes beyond the display cap:

- `25k` rows
- `50k` rows
- `100k` rows for the heaviest generic table and query paths

For capped tables, the expected result is not rendering every synthetic row. The
expected result is that query/filter metadata stays correct, displayed rows stay
bounded, scrolling remains smooth, and object actions keep canonical identity.

Validation checks:

- filter stability and metadata correctness
- count/cap correctness (`input`, `post-cap`, and visible counts)
- smooth scrolling and responsive sorting/filtering
- no obvious UI stalls during ordinary refresh or stream updates
- stable object opening, diff, navigation, and actions
- multi-cluster-safe object identity behavior
