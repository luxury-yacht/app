# Cluster Identities

Identities is a cluster-scoped view of observed subjects. It appears directly
under Cluster, after Events, outside Resources. User and Group rows come from
subjects in readable RoleBindings and ClusterRoleBindings. ServiceAccounts remain
in the RBAC resource tables and are excluded from Identities. The view is not an
account directory and does not infer group membership or effective access.

## Data and identity

`backend/refresh/snapshot/cluster_identities.go` derives rows from the existing
ingest-owned RoleBinding and ClusterRoleBinding object-map projections. These
carry the canonical binding subject links from the shared resource model. No
additional LIST/watch, catalog inference, or frontend join is used. Subject keys
contain cluster ID, kind, and exact name; user/group names remain opaque and
case-sensitive. Subjects have no namespace field or namespace filter/sort.

The Details predicate is a JSON array `[clusterId, kind, name]`. The backend
decodes it and compares all three fields exactly. JSON escaping differences
between Go and JavaScript must not change which subject matches.

These subject rows are not canonical Kubernetes object rows. The `bindings` list
carries real, complete resource references. Each binding includes its projected
role reference when available.
User/group names and Kind badges open read-only identity panels.
Source bindings open through the shared object-panel links. Duplicate subjects
within a binding count once. Grant scopes identify the namespace of a RoleBinding
or cluster-wide scope of a ClusterRoleBinding; they do not describe the
referenced role's rules.

## Queries and freshness

The raw object source revision fingerprints the complete, sorted subject set
and source coverage before filtering/paging. It stays stable across pages of
the same data and changes when subjects, binding provenance, or coverage change,
so the shared export walker can reject mixed-source results.

The `cluster-identities` snapshot domain uses the shared backend query envelope
and the shared Query Backed Static table controller. Search, type filters,
sorting, paging, exports, and table persistence use that contract. Custom
resource metadata columns are unavailable because subjects have no object labels
or annotations.

Permission admission accepts either readable binding source. ServiceAccount
permissions and readiness do not affect this domain's coverage. Each query applies
current source permissions and readiness; unavailable sources produce partial
query coverage instead of authoritative absence. The existing cluster lifecycle
owns permission recovery and source startup. Diagnostics uses the dedicated
`cluster.identities` feature with only cluster-wide `list` checks for RoleBinding
and ClusterRoleBinding.

Projectors and notification sinks register before ingestion starts. Source intake
commits retained projections before notifying the snapshot invalidator and
cluster-scoped subscribers. Completed deletions remove rows/references; a binding
with a deletion timestamp remains present until actually removed. The frontend
refetches on change signals and uses its existing polling fallback when the
stream is unavailable. Background refreshes retain the inactive cluster ID.

## Identity panels

User and Group panels share the docked/native registry, directory, tab state,
header, Details tab, and table components with resource panels. Their explicit
`identity` tab target contains only cluster ID, subject kind, and the exact name;
it never invents a Kubernetes GVK. ServiceAccounts retain resource panels.

Details queries the existing domain with an exact JSON identity predicate. It
leases query demand while visible, waits for source readiness, and refetches on
the domain's reconciliation signals. The destination reconstructs this demand
when a panel transfers; identity panels do not evict the shared cluster domain
when they close. Binding links and role links use their complete resource refs.
The binding table contains the whole returned subject's visible binding list and
uses Local Partial mode when source coverage is incomplete.

The panel exposes direct bindings and grant scopes, with partial visibility and
error states. An identity removed from all visible bindings remains an open panel
with an empty binding list. It has no YAML, mutation actions, group membership,
or effective permission calculation.

Details stacks Overview above Direct bindings using the shared section styles.
The binding columns size to their content and role links use `Kind/name`.
Partial visibility appears beside the count as a warning chip with an accessible
explanation; errors use the shared Details error block. The embedded binding
table uses shared GridTable styling, also used by the Role/ClusterRole Permissions
table.

## Regression coverage

- `backend/refresh/snapshot/cluster_identities_test.go`: subject equality,
  direct binding provenance, global queries, removal, permissions, readiness,
  equivalent JSON encodings, malformed/mismatched subject predicates, and cluster
  scope rejection.
- `backend/refresh/system/cluster_identities_test.go`: production registration
  and real REST LIST/watch intake through projection, cache invalidation, and
  subscriber delivery for both binding sources.
- `backend/refresh/resourcestream/ingest_notify_test.go`: source updates/deletes
  notify the cluster identity view; ServiceAccount changes notify RBAC only.
- `ClusterViewIdentities.test.tsx`: real table/link interaction with the query
  hook replaced by fixture rows; subjects open identity targets and source
  bindings open complete object references.
- Sidebar and background-refresh tests cover route placement and cluster routing.
- `permissionStore.test.ts`: real permission batching and diagnostics selection
  retain only the two cluster-wide binding LIST checks for Identities, preserve
  RBAC diagnostics, and exclude other clusters. The permission broker is mocked.
