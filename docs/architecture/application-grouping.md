# Application Grouping

The Applications view is a derived, query-backed namespace lens. It groups
workloads from compact ingest aggregates; the frontend must not infer groups
from the current workload page.

## Evidence selection

Each workload projects one candidate in this order:

1. `meta.helm.sh/release-name`
2. `app.kubernetes.io/managed-by=Helm` plus
   `app.kubernetes.io/instance`
3. `app.kubernetes.io/part-of`, then `instance`, then `name`
4. the controlling owner reference

The backend then joins candidates with Helm Secret and legacy ConfigMap storage
metadata and groups by `clusterId + namespace + application name`.

## Confidence and navigation

- **High:** an active Helm storage revision confirms the release. The row root
  is a complete synthetic `helm.sh/v3 HelmRelease` reference.
- **Medium:** unconfirmed Helm metadata or a controlling owner is present. Only
  a complete owner reference with cluster, group, version, kind, namespace, and
  name is navigable.
- **Low:** a recommended label or incomplete owner identifies the group. The
  row has no root and must render as non-interactive.

Confidence is about the grouping evidence, not workload health. Status and
needs-attention counts are separate backend aggregates.

## Truthfulness rules

- Workloads without evidence are excluded from groups and counted in
  `ungroupedWorkloads`; the view must show that count.
- Permission-denied or unavailable contributing kinds make the query result
  partial and surface resource issues.
- The newest Helm revision controls release activity. `superseded` and
  `uninstalled` newest revisions do not create an active group.
- Active releases may appear with zero workloads.
- Workload and Helm storage changes signal `namespace-applications`; clients
  refetch the query rather than applying streamed rows.

## Ownership and validation

- Candidate projection: `backend/resourcemodel/application.go`
- Grouping/query contract: `backend/refresh/snapshot/namespace_applications.go`
- Stream invalidation: `backend/refresh/resourcestream`
- UI: `frontend/src/modules/namespace/components/NsViewApplications.tsx`

Changes must cover evidence precedence, complete navigation identity,
permission degradation, inactive Helm revisions, and workload/Helm change
signals.
