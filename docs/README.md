# Documentation Map

Use this page to decide where to look before changing architecture, resource
behavior, frontend infrastructure, or workflow-specific code.

## Architecture

| Question                                                          | Start here                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| How should cluster-scoped data stay isolated?                     | [architecture/multi-cluster.md](architecture/multi-cluster.md)                 |
| How do snapshots, streams, refresh domains, and diagnostics work? | [architecture/refresh-system.md](architecture/refresh-system.md)               |
| What owns object identity, discovery, and existence?              | [architecture/catalog.md](architecture/catalog.md)                             |
| What owns resource status, lifecycle, links, and facts?           | [architecture/shared-resource-model.md](architecture/shared-resource-model.md) |
| How should frontend reads flow through brokers and transports?    | [architecture/data-access.md](architecture/data-access.md)                     |
| How do refresh permissions and UI action permissions work?        | [architecture/permissions.md](architecture/permissions.md)                     |
| How are auth failures detected and recovered per cluster?         | [architecture/auth.md](architecture/auth.md)                                   |
| What are the rules for large datasets and table scalability?      | [architecture/large-data.md](architecture/large-data.md)                       |

## Frontend

| Question                                                       | Start here                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------ |
| Where should frontend code live?                               | [frontend/component-structure.md](frontend/component-structure.md) |
| How should shared resource tables be built and maintained?     | [frontend/gridtable.md](frontend/gridtable.md)                     |
| How do keyboard shortcuts, surfaces, and focus ownership work? | [frontend/keyboard.md](frontend/keyboard.md)                       |
| How should blocking modals be built?                           | [frontend/modals.md](frontend/modals.md)                           |
| How do shared tabs and tab drag/drop work?                     | [frontend/tabs.md](frontend/tabs.md)                               |
| How do dockable object panels and panel tab groups work?       | [frontend/dockable-panels.md](frontend/dockable-panels.md)         |

## Workflows

| Question                                     | Start here                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| How does the object relationship map work?   | [workflows/object-map.md](workflows/object-map.md)                       |
| How are live shell, port-forward, and drain operations tracked and cleaned up? | [workflows/operation-lifecycle.md](workflows/operation-lifecycle.md) |
| How do shell exec and debug containers work? | [workflows/shell-debug.md](workflows/shell-debug.md)                     |
| Which logs doc should I use?                 | [workflows/logs/overview.md](workflows/logs/overview.md)                 |
| How do container/pod/workload logs work?     | [workflows/logs/container-logs.md](workflows/logs/container-logs.md)     |
| How do node logs work?                       | [workflows/logs/node-logs.md](workflows/logs/node-logs.md)               |
| How do app diagnostic logs work?             | [workflows/logs/application-logs.md](workflows/logs/application-logs.md) |

## Plans And Release Notes

- [plans/in-cluster-web-mode.md](plans/in-cluster-web-mode.md) is the current
  in-cluster web mode design.
- [plans/todos.md](plans/todos.md) is a lightweight feature backlog.
- [release/pending.md](release/pending.md) tracks unreleased changelog entries.

## Cross-Cutting Rules

- Every cluster-data path must carry `clusterId`; see
  [architecture/multi-cluster.md](architecture/multi-cluster.md).
- Object references crossing boundaries must carry `clusterId`, `group`,
  `version`, `kind`, plus `namespace` and `name` for concrete objects; see
  [architecture/shared-resource-model.md](architecture/shared-resource-model.md).
- The object catalog owns identity and existence; typed views add richer
  projections, not competing identity systems; see
  [architecture/catalog.md](architecture/catalog.md).
- Frontend resource reads go through `dataAccess`; app-shell and persisted
  state reads go through `appStateAccess`; see
  [architecture/data-access.md](architecture/data-access.md).
