# Architecture Docs

Use these docs by ownership area:

| Doc                                                  | Use When                                                                                                                           |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| [data-access.md](data-access.md)                     | Choosing frontend read paths, brokers, adapters, request reasons, and paused-read behavior.                                        |
| [shared-contracts.md](shared-contracts.md)           | Adding cross-layer policy, schema, descriptor, or registry contracts consumed by more than one layer.                              |
| [refresh-system.md](refresh-system.md)               | Changing refresh domains, snapshot builders, stream managers, refresh scopes, or row construction shared by snapshots and streams. |
| [catalog.md](catalog.md)                             | Working on object identity, discovery, catalog lookup/query behavior, browse ownership, or catalog freshness.                      |
| [large-data.md](large-data.md)                       | Touching table caps, pagination/load-more, virtualization, metadata sourcing, diagnostics, or high-volume UI performance.          |
| [shared-resource-model.md](shared-resource-model.md) | Defining canonical Kubernetes object references and resource model contracts.                                                      |
| [multi-cluster.md](multi-cluster.md)                 | Changing cluster identity, cluster-scoped services, aggregate services, or multi-cluster behavior.                                 |
| [permissions.md](permissions.md)                     | Changing permission checks, capability queries, or RBAC-gated UI behavior.                                                         |
| [auth.md](auth.md)                                   | Changing authentication state, auth flows, or auth-related frontend/backend contracts.                                             |

Keep details in the doc that owns the concept. Other docs should link to that
owner and keep only the local integration rules needed for their topic.
