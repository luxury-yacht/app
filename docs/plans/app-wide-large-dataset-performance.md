# App-Wide Large Dataset Performance Plan

## Intent

This plan defines the performance model for every data view in Luxury Yacht.

The goal is:

- every view loads its active dataset as quickly as possible
- no view requires user-visible pagination or manual "load more"
- every large list renders through virtualization
- the app remains responsive as dataset sizes grow far beyond current real
  clusters

This is broader than Browse. It applies to all list and table surfaces across
the app.

This plan does **not** replace the catalog architecture note in
`docs/development/catalog-architecture.md`. That document describes identity
and retrieval layering. This plan describes the app-wide runtime performance
model.

## Product Goal

The user should be able to open any data-heavy screen and:

- see data begin loading immediately
- avoid pagination controls entirely
- scroll smoothly through large result sets
- sort, filter, and interact without noticeable lag

Current real-cluster validation floors are:

- roughly `2800` objects in Cluster Browse
- roughly `13000` objects in All Namespaces Browse

Those are useful validation datasets, not design ceilings.

The architecture should be validated against much larger synthetic datasets as
well.

## Core Position

The app should optimize for **eager full-result loading with virtualized
rendering**.

That means:

- fetch the full active result set for the current view/query
- keep it in memory when practical for that view
- render only the visible rows plus overscan
- process updates incrementally instead of replacing whole datasets

The point is not merely to render many DOM rows efficiently. The point is to
keep the entire interaction model fast even when the active dataset is large.

## Scope

This plan applies to:

- Browse views
- namespace-scoped typed views
- cluster-scoped typed views
- any other table or list showing Kubernetes objects or object-derived rows

This plan also applies to supporting behaviors that affect perceived
performance:

- sorting
- filtering
- selection
- row actions
- opening object panels
- context menus
- refresh and watch-driven updates

## Non-Goals

This plan does **not** require:

- one universal payload shape for every screen
- every screen to render directly from catalog rows
- eliminating typed projections or typed refresh domains
- keeping all historical query results in memory

The goal is app-wide performance consistency, not app-wide row-shape
uniformity.

## Performance Doctrine

Every large data view should follow the same rules:

1. Load the active dataset as fast as possible.
2. Avoid user-visible pagination and manual "load more".
3. Render through virtualization.
4. Preserve stable row identity:
   `clusterId + group + version + kind + namespace + name`
5. Merge updates incrementally.
6. Avoid repeated client-side full-dataset work on ordinary interactions.

`uid` should remain available for lifecycle-sensitive workflows, but it is not
the primary row key.

## What Actually Causes Slowdowns

Large-data performance problems are not caused only by DOM row count.

The main risks are:

- rebuilding large arrays unnecessarily
- repeated client-side sorting/filtering over full datasets
- replacing entire datasets on refresh
- deriving metadata from loaded rows over and over
- expensive row rendering
- per-row follow-up fetches
- coarse-grained state updates that rerender too much UI

Virtualization is necessary, but by itself it does not solve these problems.

## Architectural Rules

### 1. Shared Virtualized Table Foundation

Every large tabular view should use the same virtualized table foundation.

That foundation should support:

- eager finite datasets
- stable row identity
- row-level actions and context menus
- keyboard navigation
- loading overlays and empty states
- variable column sets without changing the performance model

The default expectation should be that all large lists are virtualized.

### 2. Eager Full-Result Loading

Views should load the full active result set for the current scope/query rather
than exposing pagination to the user.

Transport may still be chunked internally, but that is an implementation
detail. The view should automatically drain the result until the active dataset
is complete.

This means:

- no "Load More" button
- no user pagination controls
- no requirement for the user to know how much of the dataset is currently
  loaded

### 3. Incremental Update Paths

Views must avoid replacing entire in-memory datasets when only a small subset
changed.

Update pipelines should prefer:

- upsert by stable identity
- deletion by stable identity
- minimal index maintenance
- batched state publication

This is required both for steady-state refreshes and for watch-driven churn.

### 4. Cheap Sort and Filter Paths

Sorting and filtering must not become an O(n log n) or O(n) hot-path tax on
every small update.

Depending on the screen, that may mean:

- backend-shaped sort/filter results
- memoized derived indexes
- explicit recomputation boundaries
- view-specific strategies for expensive computed columns

The important rule is that large views should not repeatedly redo full-dataset
work for trivial changes.

### 5. Bounded Enrichment

Views may need richer data than the base list payload, but enrichment must be
bounded.

Avoid:

- one extra request per row
- ad hoc row hydration during scroll
- repeated heavy detail fetches for non-visible rows

Prefer:

- richer server-shaped list payloads where justified
- bounded batch follow-up fetches
- object-panel hydration only after object identity is known

### 6. Canonical Identity Everywhere

Every row representing a Kubernetes object must carry canonical object
identity:

- `clusterId`
- `group`
- `version`
- `kind`
- `namespace`
- `name`

with empty `namespace` for cluster-scoped objects.

This is required for:

- stable rendering keys
- incremental updates
- row actions
- panel routing
- safe cross-view interactions

## Relationship to the Catalog

The catalog still matters, but it is not the entire performance strategy.

The catalog should continue to own:

- canonical cross-kind object identity
- object existence
- metadata such as kinds and namespaces
- exact object resolution for generic workflows

Performance across all views depends primarily on:

- eager loading strategy
- update granularity
- virtualization
- sort/filter cost
- rendering cost

So the app should unify around a performance model, not force every screen onto
one final payload shape.

## Phased Implementation

### Phase 1: Shared Table and Browse Baseline

- [ ] Remove user-visible "load more" behavior from Browse.
- [ ] Ensure Browse drains its active result set automatically.
- [ ] Make virtualization the default for Browse tables.
- [ ] Eliminate obvious full-array replacement paths in Browse refresh logic.
- [ ] Measure render time, sort time, filter time, and update time at current
  real-cluster sizes.

Phase 1 is the first proof that the model works in production data shapes.

### Phase 2: Shared Eager-Dataset Contract

- [ ] Define one shared eager-dataset table contract for fully loaded views.
- [ ] Add adapters for existing array-backed typed views.
- [ ] Remove user-facing pagination concepts from shared table controls.
- [ ] Standardize stable row-key behavior across shared tables.
- [ ] Ensure row selection, focus, and context menus remain stable under
  incremental updates.

Phase 2 makes Browse and typed views converge on the same runtime model.

### Phase 3: Typed View Migration

- [ ] Audit every cluster-scoped and namespace-scoped typed view.
- [ ] Convert typed views to the shared virtualized eager-dataset foundation.
- [ ] Replace full-dataset refresh replacement with incremental merge paths
  where needed.
- [ ] Identify screens that require richer server-shaped list payloads and keep
  those projections bounded.
- [ ] Validate that object-opening and row-action flows preserve canonical
  identity everywhere.

Phase 3 is where app-wide consistency is actually achieved.

### Phase 4: Scaling and Stress Validation

- [ ] Add synthetic large-dataset fixtures or generators for frontend
  performance validation.
- [ ] Test at sizes beyond current clusters, including at least `25k`, `50k`,
  and `100k` rows where practical.
- [ ] Record baseline and target metrics for initial load latency, scroll
  smoothness, sort latency, filter latency, refresh/update latency, and memory
  growth.
- [ ] Identify hard ceilings and document which screens need deeper
  optimization.

Phase 4 turns the goal from aspiration into something measurable.

## Validation Strategy

The app should be validated against both:

- real clusters
- synthetic larger-than-real datasets

Real-cluster validation ensures the model works on actual resource mixes.
Synthetic validation ensures the architecture does not overfit to today's
cluster sizes.

The performance bar should be:

- no user-visible pagination
- smooth scrolling
- responsive sorting/filtering
- no obvious UI stalls during ordinary updates

## Decision Rule

When making implementation choices, prefer the approach that:

- keeps the full active dataset available to the view
- avoids user-visible pagination
- preserves canonical object identity
- minimizes repeated whole-dataset work
- keeps rendering virtualized
- scales to much larger datasets than today's known clusters

If a solution improves Browse but cannot generalize to the rest of the app, it
is not the final answer.
