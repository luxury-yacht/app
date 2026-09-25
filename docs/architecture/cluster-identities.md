# Cluster Identities

Identities is a cluster-scoped view of observed subjects. It appears directly
under Cluster, after Events, outside Resources. User and Group rows come from
subjects in readable RoleBindings and ClusterRoleBindings. ServiceAccount rows
come from readable ServiceAccount objects, including accounts without direct
bindings. A binding reference alone does not establish a ServiceAccount's
existence. The view is not an account directory and does not infer group
membership or effective access.

## Data and identity

`backend/refresh/snapshot/cluster_identities.go` derives rows from the existing
ingest-owned RoleBinding, ClusterRoleBinding, and ServiceAccount object-map
projections. These carry the canonical binding subject links from the shared
resource model. No additional LIST/watch, catalog inference, or frontend join
is used. Subject keys contain cluster ID, type, exact name, and ServiceAccount
namespace; user/group names remain opaque and case-sensitive.

These subject rows are not canonical Kubernetes object rows. Only the optional
`serviceAccount` field and the `bindings` list carry real, complete resource
references. User/group names render as text. ServiceAccounts and source bindings
open through the shared object-panel links. Duplicate subjects within a binding
count once. Grant scopes identify the namespace of a RoleBinding or cluster-wide
scope of a ClusterRoleBinding; they do not describe the referenced role's rules.

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

Permission admission accepts any readable source. Each query applies current
source permissions and readiness; unavailable sources produce partial query
coverage instead of authoritative absence. The existing cluster lifecycle owns
permission recovery and source startup.

Projectors and notification sinks register before ingestion starts. Source intake
commits retained projections before notifying the snapshot invalidator and
cluster-scoped subscribers. Completed deletions remove rows/references; a binding
with a deletion timestamp remains present until actually removed. The frontend
refetches on change signals and uses its existing polling fallback when the
stream is unavailable. Background refreshes retain the inactive cluster ID.

## Regression coverage

- `backend/refresh/snapshot/cluster_identities_test.go`: subject equality,
  direct binding provenance, global queries, removal, permissions, readiness,
  and cluster scope rejection.
- `backend/refresh/system/cluster_identities_test.go`: production registration
  and real REST LIST/watch intake through projection, cache invalidation, and
  subscriber delivery for all three sources.
- `backend/refresh/resourcestream/ingest_notify_test.go`: source updates/deletes
  notify the cluster identity view.
- `ClusterViewIdentities.test.tsx`: real table/link interaction with the query
  hook replaced by fixture rows; only real object references open panels.
- Sidebar and background-refresh tests cover route placement and cluster routing.
