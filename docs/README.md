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

## Architecture Contracts

| Question | Start here |
| --- | --- |
| How is cluster data isolated? | [architecture/multi-cluster.md](architecture/multi-cluster.md) |
| How do refresh domains, snapshots, streams, and scopes work? | [architecture/refresh-system.md](architecture/refresh-system.md) |
| When can a query-backed domain's live stream skip shipping/retaining rows? | [architecture/notify-only-streams.md](architecture/notify-only-streams.md) |
| What owns object existence and GVK/GVR identity? | [architecture/catalog.md](architecture/catalog.md) |
| What owns object refs, status, facts, and links? | [architecture/shared-resource-model.md](architecture/shared-resource-model.md) |
| How is per-kind behavior declared and dispatched, and where does the kind vocabulary live? | [architecture/resource-kind-registry.md](architecture/resource-kind-registry.md) |
| Where should cross-layer contracts live? | [architecture/shared-contracts.md](architecture/shared-contracts.md) |
| How should frontend reads reach backend data? | [architecture/data-access.md](architecture/data-access.md) |
| How do permission gates and action capabilities work? | [architecture/permissions.md](architecture/permissions.md) |
| How are auth failures represented and recovered? | [architecture/auth.md](architecture/auth.md) |
| What are the large-data table rules? | [architecture/large-data.md](architecture/large-data.md) |
| How do YAML edits save, merge, and check field ownership? | [architecture/yaml-editing.md](architecture/yaml-editing.md) |

## Frontend Contracts

| Question | Start here |
| --- | --- |
| Where should frontend code live? | [frontend/component-structure.md](frontend/component-structure.md) |
| How should shared tables be built? | [frontend/gridtable.md](frontend/gridtable.md) |
| How are shortcuts and focus owned? | [frontend/keyboard.md](frontend/keyboard.md) |
| How should blocking modals work? | [frontend/modals.md](frontend/modals.md) |
| How do shared tabs and tab dragging work? | [frontend/tabs.md](frontend/tabs.md) |
| How do docked/floating object panels work? | [frontend/dockable-panels.md](frontend/dockable-panels.md) |
| How should shared YAML editors work? | [frontend/yaml-editor.md](frontend/yaml-editor.md) |

## Workflow Contracts

| Question | Start here |
| --- | --- |
| How does the object map work? | [workflows/object-map.md](workflows/object-map.md) |
| How are live operations tracked and cleaned up? | [workflows/operation-lifecycle.md](workflows/operation-lifecycle.md) |
| How do shell exec and debug containers work? | [workflows/shell-debug.md](workflows/shell-debug.md) |
| Which logs doc applies? | [workflows/logs/overview.md](workflows/logs/overview.md) |

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
- Prefer links to owning code over copied implementation detail.
- Delete completed or stale plans instead of indexing them here.
- Put temporary implementation plans in `docs/plans/` only while they are active.
- Put unreleased changelog entries in [release/pending.md](release/pending.md).
