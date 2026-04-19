# Large Dataset Hardening Roadmap

## Intent

This plan covers the remaining harder work needed to make large data views in
Luxury Yacht fast, correct, and predictable.

It assumes the current product model:

- no user-visible pagination
- capped table result sets
- virtualization for large tables
- users narrow oversized views with filters

This roadmap does **not** try to restore the older "always load the full active
dataset" approach from `app-wide-large-dataset-performance.md`.

## Current Baseline

The following foundation is already in place:

- ✅ shared table max-rows cap with Settings control
- ✅ capped views show `n of n items` and explain how to reduce the dataset
- ✅ user-visible "load more" removed
- ✅ large `GridTable` views use the shared virtualized table model
- ✅ Browse filter metadata no longer comes from the actively filtered result set
- ✅ typed views pass precomputed kind/namespace filter options where available,
  avoiding some redundant dataset rescans
- ✅ canonical identity helpers now back Browse, major cluster views, major
  namespace views, and object-panel Pods/Jobs tables
- ✅ event views use the shared identity helper for involved-object references
  while keeping event row keys event-specific
- ✅ object-table action menus now build shared object/synthetic-object
  references instead of hand-rolling per-view `object:` payloads
- ✅ object-panel overview links now build shared object references, with
  explicit plain-text fallback for malformed legacy refs that still lack full
  GVK data
- ✅ all-namespaces table namespace filters now prefer explicit namespace
  metadata over rescanning loaded row payloads, with row-derived fallback only
  when metadata is unavailable
- ✅ typed-view kind filters now use a shared local-metadata hook, making the
  current row-derived kind-option policy explicit until richer domain metadata
  exists
- ✅ single-kind typed domains now use explicit kind metadata instead of
  deriving kind filters from the loaded row payload
- ✅ mixed-kind typed domains now thread explicit backend `kinds` metadata
  through the refresh payload, resource context, and view layers so their
  `Kinds` filters no longer depend on capped row sets
- ✅ sidebar namespace groups now aggregate catalog metadata across active
  scoped domains before filtering to the selected cluster

Those were the easy wins. The remaining work is architectural and touches row
identity, metadata strategy, refresh/update behavior, and performance
measurement.

## Goals

- every object-facing table uses one canonical object identity model
- large views stay responsive under churn, not just on initial render
- filter/search/sort behavior is explicit and consistent per view family
- metadata-driven controls remain stable and do not rebuild from transient row
  payloads
- performance changes are measured before and after, not judged by guesswork

## Non-Goals

- rewriting all typed views into catalog-row views
- removing typed refresh domains where they remain the right payload shape
- eliminating capped tables
- making every view share one identical query model

## Phase 1: ✅ Canonical Object Identity

Make canonical identity explicit everywhere an object row appears.

Required identity:

- `clusterId`
- `group`
- `version`
- `kind`
- `namespace`
- `name`

with empty `namespace` for cluster-scoped objects.

`uid` remains important for lifecycle-sensitive workflows, but it is not the
primary row key.

### Tasks

- ✅ Audit `GridTable` object rows across Browse, cluster views, namespace
  views, and object-panel tables.
- ✅ Identify rows that still infer or omit any part of canonical identity.
- ✅ Standardize object-row helpers so actions, selection, and navigation use
  one shared identity shape.
- ✅ Standardize `keyExtractor` usage for object rows.
- ✅ Confirm favorites, object opening, context menus, and cross-view actions
  all use the same identity contract.

### Exit Criteria

- ✅ every object row carries full canonical identity
- ✅ no view relies on partial object identity for row keys or object actions
- ✅ object-opening and action flows remain explicitly `clusterId` + GVK aware
- ✅ synthetic non-GVK surfaces such as `HelmRelease` remain explicitly
  documented exceptions rather than silently using fake GVKs

## Phase 2: ✅ Shared Table Object Contract

Reduce per-view drift in how object tables are wired.

### Tasks

- ✅ Define one shared object-row contract for `GridTable` consumers.
- ✅ Add shared helpers for:
  - ✅ building object row keys
  - ✅ mapping object rows into panel/action references
  - ✅ common object-table filter option wiring
- ✅ Replace ad hoc view-local object key/reference building where practical.
- ✅ Document when a table is an object table versus a non-object table.

### Exit Criteria

- ✅ object tables follow one recognizable wiring pattern
- ✅ common object actions no longer depend on view-local identity glue

## Phase 3: ✅ Metadata Sourcing Strategy

Make filter/sidebar metadata intentionally sourced instead of inferred from
whatever rows happen to be loaded.

### Tasks

- ✅ Classify each table family:
  - ✅ local metadata is acceptable
  - ✅ explicit metadata source is required
  - ✅ query-scoped metadata source is required
- ✅ Keep Browse on stable scope-level metadata.
- ✅ Review all-namespaces typed views for namespace and kind option stability.
- ✅ Review sidebar/category metadata sourcing against the catalog contract.
- ✅ Document where metadata is allowed to come from loaded rows and where it
  is not.

### Exit Criteria

- ✅ filter menus do not reshape themselves from transient filtered row payloads
- ✅ metadata sourcing is explicit per view family

Current status:

- ✅ Browse uses stable scope-level metadata
- ✅ all-namespaces namespace filters prefer explicit namespace metadata
- ✅ mixed-kind typed domains use explicit backend `kinds` metadata
- ✅ single-kind typed domains use explicit kind metadata constants
- ✅ custom-resource views remain intentional local-metadata exceptions until a
  stronger custom-domain metadata source exists

## Phase 4: Sort, Filter, and Search Ownership

Decide where interaction truth lives for each table family and make the UI
semantics match.

### Tasks

- Define behavior for each major table family:
  - Browse
  - all-namespaces typed views
  - cluster typed views
  - object-panel tables
- For each family, document whether search/filter/sort operate on:
  - capped local rows
  - backend/query-shaped results
  - a hybrid model
- Align count text, empty states, and tooltip language with those semantics.
- Identify views where current behavior is ambiguous to users.

### Exit Criteria

- each major table family has a clear interaction model
- users can tell what search and filters actually apply to

Current status:

- ✅ Browse uses query-shaped search and kind/namespace filters, with local sort
  on the returned row set and query-backed total counts
- ✅ cluster and all-namespaces typed views use local search/filter/sort over
  the loaded row set, with explicit filter metadata where Phase 3 introduced it
- ✅ object-panel Pods and Jobs use local search/filter/sort over the loaded row
  set
- ✅ object-panel Events currently uses local sort only and does not expose the
  shared filter/search bar
- ✅ shared empty-state language now makes filter-empty tables read as “no
  matching items” instead of looking identical to truly empty datasets

## Phase 5: Measured Update-Path Improvements

Improve hot update paths only after measuring them.

### Tasks

- Instrument the largest/highest-churn surfaces first:
  - Browse
  - all-namespaces typed tables
  - large object-panel tables where applicable
- Measure:
  - full-array replacement frequency
  - filter-option derivation cost
  - sort/filter recomputation cost
  - rerender cost during updates
- Prioritize the worst offenders for incremental update work.
- Prefer:
  - upsert/delete by canonical identity
  - batched publication
  - narrower recomputation boundaries
- Avoid speculative caching in hot paths without measurement.

### Exit Criteria

- identified hot views no longer do obvious broad dataset replacement for small
  updates
- performance work is backed by before/after measurements

## Phase 6: Catalog Alignment for Generic Object Workflows

Strengthen catalog-backed identity without forcing typed views to become
catalog rows.

### Tasks

- Audit object-opening, diff, command-palette, and similar generic workflows.
- Ensure those workflows resolve object identity consistently through the
  catalog model.
- Keep typed views on typed payloads where appropriate, but remove alternate
  identity conventions.
- Document the boundary between:
  - catalog identity/existence
  - typed projection payloads

### Exit Criteria

- generic object workflows share one identity backbone
- typed views do not invent competing identity models

## Rollout Order

Implement the remaining work in this order:

1. Phase 1: canonical object identity
2. Phase 2: shared table object contract
3. Phase 3: metadata sourcing strategy
4. Phase 4: sort/filter/search ownership
5. Phase 5: measured update-path improvements
6. Phase 6: catalog alignment for generic workflows

Use this view-family rollout inside each phase:

1. Browse
2. all-namespaces typed views
3. cluster typed views
4. object-panel tables

## Validation

Validation should include both real and synthetic datasets.

Minimum validation surfaces:

- Cluster Browse on a real large cluster
- All Namespaces Browse on a real large cluster
- representative all-namespaces typed views
- representative cluster typed views

Validation should check:

- filter stability
- count/cap correctness
- responsiveness during refresh churn
- stable object actions and object opening
- multi-cluster-safe object identity behavior

## Success Criteria

This roadmap is complete when:

- object rows use one canonical identity model across the app
- metadata-driven controls are stable and intentionally sourced
- table interaction semantics are explicit per view family
- large-table updates are measured and improved where the data shows real cost
- generic object workflows align to catalog identity without forcing a
  catalog-only UI model
