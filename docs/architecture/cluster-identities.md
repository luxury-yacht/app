# Cluster Identities

Identities is a cluster-scoped view of User and Group subjects observed in
readable RoleBindings and ClusterRoleBindings. It sits directly under Cluster,
after Events, outside Resources. ServiceAccounts are excluded (they stay in the
RBAC tables). It is not an account directory and never infers group membership
or effective access.

## Data and identity

- `backend/refresh/snapshot/cluster_identities.go` derives rows from the
  ingest-owned RoleBinding/ClusterRoleBinding object-map projections and their
  canonical subject links. No extra LIST/watch, catalog inference, or frontend
  join.
- Subject key = `clusterId`, kind, exact name. Names are opaque and
  case-sensitive. Subjects have no namespace field, filter, or sort.
- The Details predicate is a JSON array `[clusterId, kind, name]`; the backend
  decodes it and compares all three exactly, so Go/JavaScript JSON escaping
  differences cannot change the match.
- Subject rows are not Kubernetes object rows. `bindings` carries complete
  resource references, each with its projected role reference when available.
  Duplicate subjects within a binding count once. User/group names and Kind
  badges open read-only identity panels; source bindings open through the
  shared object-panel links.
- Grant scope is the RoleBinding's namespace or the ClusterRoleBinding's
  cluster-wide scope; it never describes the role's rules.

## Queries and freshness

- The `cluster-identities` domain uses the shared backend query envelope and the
  Query Backed Static table controller (search, type filters, sort, paging,
  export, persistence). No custom metadata columns: subjects have no labels or
  annotations.
- The raw source revision fingerprints the complete sorted subject set and
  source coverage before filtering/paging: stable across pages, changed by
  subject, provenance, or coverage changes, so the export walker rejects
  mixed-source results.
- Admission accepts either readable binding source; ServiceAccount permissions
  and readiness never affect coverage. Each query applies current source
  permissions and readiness; unavailable sources yield partial coverage, not
  authoritative absence. Cluster lifecycle owns permission recovery and source
  startup. Diagnostics uses the `cluster.identities` feature with only the two
  cluster-wide binding `list` checks.
- Projectors and notification sinks register before ingestion starts. Intake
  commits retained projections before notifying the snapshot invalidator and
  cluster-scoped subscribers. Completed deletions remove rows and references; a
  binding with only a deletion timestamp stays. The frontend refetches on change
  signals, falls back to polling without a stream, and background refreshes
  keep the inactive cluster's ID.

## Identity panels

- User/Group panels share the docked/native registry, directory, tab state,
  header, Details tab, and table components with resource panels. The
  `identity` tab target holds only `clusterId`, subject kind, and exact name; it
  never invents a GVK. ServiceAccounts keep resource panels.
- Details queries the domain with the exact JSON predicate, leases demand while
  visible, waits for source readiness, and refetches on reconciliation signals.
  A transferred panel's destination reconstructs that demand; closing an
  identity panel never evicts the shared cluster domain.
- The panel shows direct bindings and grant scopes with partial-visibility and
  error states. Binding and role links use complete resource refs; the binding
  table shows the subject's whole visible binding list in Local Partial mode
  when coverage is incomplete. An identity removed from all bindings stays open
  with an empty list. No YAML, mutations, group membership, or effective
  permissions.
- Layout reuses shared styles: Overview above Direct bindings, content-sized
  binding columns, role links as `Kind/name`, partial visibility as a warning
  chip beside the count with an accessible explanation, errors in the shared
  Details error block, and the shared GridTable styling used by the
  Role/ClusterRole Permissions table.

## Regression coverage

- `backend/refresh/snapshot/cluster_identities_test.go`: subject equality,
  provenance, queries, removal, permissions, readiness, equivalent JSON
  encodings, malformed/mismatched predicates, cluster-scope rejection.
- `backend/refresh/system/cluster_identities_test.go`: production registration
  and real REST LIST/watch intake through projection, invalidation, and
  subscriber delivery for both sources.
- `backend/refresh/resourcestream/ingest_notify_test.go`: binding changes notify
  Identities; ServiceAccount changes notify RBAC only.
- `ClusterViewIdentities.test.tsx` (query hook replaced by fixture rows):
  subjects open identity targets; bindings open complete object refs.
- Sidebar and background-refresh tests cover route placement and cluster
  routing.
- `permissionStore.test.ts` (permission broker mocked): Identities keeps only
  the two cluster-wide binding LIST checks, preserves RBAC diagnostics, and
  excludes other clusters.
