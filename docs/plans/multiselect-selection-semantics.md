# App-wide multiselect selection semantics

## Goal

Make filter-style multiselects distinguish these states everywhere:

- **All**: the filter is unrestricted and newly available options remain included.
- **Some**: only the selected values match.
- **None**: nothing matches.

The Columns multiselect remains an enabled-column set: all values show every
hideable column and no values hide every hideable column.

## Contract trace

- `Dropdown` produces the selected option values; it does not own filter
  semantics.
- GridTable owns local filter state and persistence. Query-backed resource grids
  translate that state into the refresh scope consumed by typed and catalog
  query providers.
- Object Map owns frontend-only kind visibility.
- Application Logs owns frontend-only filtering of its app-global diagnostic
  buffer.
- Object Log selection controls both frontend buffer filtering and the
  cluster-scoped container-log stream target.
- Favorites persist GridTable filters through the backend-owned favorites file.

## Phases

1. [x] Add a shared, unambiguous filter-selection representation and tests for
   All, Some, None, option changes, and Dropdown value conversion.
2. [x] Migrate GridTable local filters, controlled state, reset behavior,
   result-count behavior, and v2 local persistence with red/green tests.
3. [x] Carry explicit-none through typed and catalog query requests while
   preserving full option vocabularies; add frontend scope and backend provider
   regression tests before implementation.
4. [x] Migrate saved Favorite filters and their schema so All and None survive
   backend persistence; add migration and round-trip tests first.
5. [x] Migrate Object Map and Application Logs with focused red/green tests.
6. [x] Migrate Object Log source selection through reducer preferences,
   frontend filtering, and stream scope; prove All/Some/None and cluster/object
   identity behavior with focused tests.
7. [x] Update durable GridTable/log/object-map documentation, run rendered UI
   checks across representative dropdowns, then run `mage qc:prerelease` on the
   latest worktree.

## Ordering and dependency checks

- The shared selection module is a leaf under `frontend/src/shared` and imports
  no feature code.
- GridTable, Object Map, logs, and Favorites consume the shared module; the
  shared module does not import any of them, so the change does not introduce a
  circular dependency.
- Query requests remain cluster-prefixed. The new match-none signal changes only
  the matched set and never supplies or infers cluster identity.
- Object Log stream requests retain their existing cluster ID and complete
  workload/pod/container target identity; selection state changes only which
  already-resolved sources are requested.
- Persisted v1 empty arrays represented unrestricted filters. Migrations must
  translate those values to All before v2 treats an empty selection as None.

## Required regression proof

- Initial/reset All shows all options selected and all results.
- Selecting a subset narrows results.
- Deselecting the final option produces zero results and remains None after
  refresh/remount/persistence.
- Selecting all again returns to the dynamic All state.
- Query-backed None returns an exact empty result while leaving option controls
  usable.
- Columns retains its existing show-all/hide-all behavior.
- Multi-cluster query and log paths retain the originating `clusterId`.
