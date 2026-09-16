# Agent Documentation

This directory exists to help agents change Luxury Yacht correctly. Keep docs
short, contract-focused, and cheaper to maintain than re-reading the code.

Durable docs should answer:

- What invariant must not be broken?
- Which subsystem owns the contract?
- Which files are the starting points?
- What must be validated after a change?

Do not use durable docs for implementation inventories, current UI walkthroughs,
completed phase plans, or test lists that can be discovered with `rg`.

Use the matching question below. Within a long document, read its shared
invariants and the sections selected by the task. Follow links only when the
changed producer/consumer path needs that contract; links are not a recursive
reading checklist.

## Reading a section

A Markdown fragment names a heading; it does not limit a file read. For a link
such as `gridtable-columns.md#column-definitions`, list headings with
`rg -n '^#{1,6} ' docs/frontend/gridtable-columns.md`. Find the target heading and
the next heading at the same or higher level, then use `sed -n 'START,ENDp'` with
the start line through the line before that next heading (or EOF) to read only
that section, including its subsections. Read shared invariants when first
entering the subsystem; expand only for affected contracts. Small documents can
be read in full.

## Architecture Contracts

| Question | Start here |
| --- | --- |
| How is the backend decomposed into services, and which dependency directions are allowed? | [architecture/backend-services.md](architecture/backend-services.md) |
| How is cluster data isolated? | [architecture/multi-cluster.md](architecture/multi-cluster.md) |
| When should retained data paint, refresh, stream, poll, or create background work? | [architecture/data-freshness.md](architecture/data-freshness.md) |
| How do refresh domains, snapshots, streams, and scopes work? | [architecture/refresh-system.md](architecture/refresh-system.md) |
| How does the backend store, ingest, and serve table data (store, ingest, governor, delivery)? | [architecture/data-layer.md](architecture/data-layer.md) |
| How should resource utilization metrics be read and refreshed? | [architecture/resource-metrics.md](architecture/resource-metrics.md) |
| What owns object existence and GVK/GVR identity? | [architecture/catalog.md](architecture/catalog.md) |
| What owns object refs, status, facts, and links? | [architecture/shared-resource-model.md](architecture/shared-resource-model.md) |
| How is per-kind behavior declared and dispatched, and where does the kind vocabulary live? | [architecture/resource-kind-registry.md](architecture/resource-kind-registry.md) |
| Where should cross-layer contracts live? | [architecture/shared-contracts.md](architecture/shared-contracts.md) |
| Who owns settings schema, preference persistence, rollback, and runtime effects? | [architecture/app-preferences.md](architecture/app-preferences.md) |
| How should frontend reads reach backend data? | [architecture/data-access.md](architecture/data-access.md) |
| How do permission gates and action capabilities work? | [architecture/permissions.md](architecture/permissions.md) |
| How are auth failures represented and recovered? | [architecture/auth.md](architecture/auth.md) |
| How is Sentry error reporting configured and bounded? | [architecture/error-reporting.md](architecture/error-reporting.md) |
| How do Wails startup, readiness, windows, single-instance launches, and shutdown work? | [architecture/application-lifecycle.md](architecture/application-lifecycle.md) |
| What are the large-data table rules? | [architecture/large-data.md](architecture/large-data.md) |
| How do YAML edits save, merge, and check field ownership? | [architecture/yaml-editing.md](architecture/yaml-editing.md) |

## Frontend Contracts

| Question | Start here |
| --- | --- |
| Where should frontend code live? | [frontend/component-structure.md](frontend/component-structure.md) |
| How are Global and per-cluster workspaces separated? | [frontend/navigation.md](frontend/navigation.md) |
| How should shared tables be built? | [frontend/gridtable.md](frontend/gridtable.md) |
| How should dedicated CRD-family tables and overviews be presented? | [frontend/custom-resource-views.md](frontend/custom-resource-views.md) |
| How should object age text update? | [frontend/live-age.md](frontend/live-age.md) |
| How are shortcuts and focus owned? | [frontend/keyboard.md](frontend/keyboard.md) |
| How should blocking modals work? | [frontend/modals.md](frontend/modals.md) |
| How do shared tabs and tab dragging work? | [frontend/tabs.md](frontend/tabs.md) |
| How do docked/floating object panels work? | [frontend/dockable-panels.md](frontend/dockable-panels.md) |
| How should shared YAML editors work? | [frontend/yaml-editor.md](frontend/yaml-editor.md) |
| How are Biome rules and exceptions governed? | [frontend/biome.md](frontend/biome.md) |
| How are Sonar findings remediated without regression? | [frontend/sonar.md](frontend/sonar.md) |

## Workflow Contracts

| Question | Start here |
| --- | --- |
| What must Claude Code prepare before a production edit? | [workflows/impact-analysis.md](workflows/impact-analysis.md) |
| Which recurring implementation mistakes must agents prevent? | [workflows/common-mistakes.md](workflows/common-mistakes.md) |
| Which tests are worth adding or retaining? | [workflows/testing.md](workflows/testing.md) |
| How does the object map work? | [workflows/object-map.md](workflows/object-map.md) |
| How are live operations tracked and cleaned up? | [workflows/operation-lifecycle.md](workflows/operation-lifecycle.md) |
| How do shell exec and debug containers work? | [workflows/shell-debug.md](workflows/shell-debug.md) |
| How are application updates discovered, authenticated, published, applied, and recovered? | [workflows/application-updates.md](workflows/application-updates.md) |
| Which logs doc applies? | [workflows/logs/overview.md](workflows/logs/overview.md) |
| How do I diagnose a wedged backend (views stuck loading, suspected deadlock)? | [workflows/goroutine-dump.md](workflows/goroutine-dump.md) |

## Cross-Cutting Rules

- Every cluster-data path must carry `clusterId`.
- Object references crossing boundaries must carry `clusterId`, `group`,
  `version`, and `kind`; concrete objects also need `namespace` and `name`.
- The object catalog owns existence and GVK/GVR identity.
- The backend shared resource model owns primary resource status and relationship
  links.
- Frontend resource reads go through `dataAccess`; app-shell and persisted-state
  reads go through `appStateAccess`.
- Shared contracts belong beside enforcing code, with docs summarizing the rule.

## Maintenance Policy

- Keep each durable doc under roughly 150 lines unless the extra detail prevents
  repeated mistakes.
- Keep entry rules and skill bodies focused on shared invariants and task
  routing. Put substantial conditional procedures in the owning doc/reference;
  add a route block when it selects a meaningful subset or redirects to another
  file, not merely to repeat the document's headings.
- Run `mise exec -- wails3 task qc:docs` after changing Markdown links or
  headings. It checks local link targets and heading anchors in versioned and
  untracked, non-ignored Markdown; external URLs, code-span paths, and dynamic
  release-template destinations are excluded.
- Prefer links to owning code over copied implementation detail.
- Delete completed or stale plans instead of indexing them here.
- Put temporary implementation plans in `docs/plans/` only while they are active.
- Put unreleased changelog entries in [release/pending.md](release/pending.md).
