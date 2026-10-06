# Custom-resource views

Dedicated presentation for a discovered CRD family reuses the catalog,
GridTable, and Overview infrastructure. Discovery, identity, visibility, query
boundaries, and projection ownership follow the
[catalog contract](../architecture/catalog.md#discovered-resource-families).

## Presentation Contracts

- Each family keeps the per-view lifecycle for cluster, namespace, and All
  Namespaces routes. Reuse ResourceInventoryTable/GridTable; pending actions
  stay with the view that opened them. A shared data adapter never justifies
  retaining a view instance across families.
- One family table (Karpenter included) keeps the existing Kind filter; no
  per-kind tabs for differing fields. Families have independent persistence
  per scope and discovery-gated sidebar and command-palette entries.
- Columns have specific names; each table cell and CSV export value holds one
  value of the same field (including Karpenter's `KarpenterSummary` columns).
  Long configuration lists go in Details.
- Production column builders own sizing; stories use that same path, with no
  layout transformations absent from the live view.
- Overviews use the shared frame, kind-specific summaries, and labeled
  sections. Omit empty sections; keep meaningful zero values.
- Identifiers and values stay selectable and copyable, including repeated
  lists and tooltip content; check selection under the production `.app` CSS
  reset, including text-bearing descendants.
- Conditions and taints follow the Node panel's shared `StatusChip` pattern:
  condition-dependent colors, message/reason tooltips, and original taint
  key/value/effect casing.
- Overviews use titled repeated entries and full-width messages, and add no
  operator-specific actions or graph topology.
- Validate with realistic long values, sparse objects, and narrow panels.
  Exercise selection, copy, and tooltip keyboard access directly (screenshots
  do not prove them) and distinguish Storybook fixture previews from
  live-cluster and native Wails validation.

## Karpenter

Owners: `KarpenterSections.tsx`, `KarpenterProgress.tsx`,
`karpenterCapacityFormat.ts`, and `descriptors/karpenter.tsx` under
`frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/`;
columns in `frontend/src/modules/cluster/components/karpenterColumns.tsx`.

### Requirements

Keep the name **Requirements** (matches YAML). Render every source requirement,
including custom keys that look like metadata labels. Show readable labels with
the exact key in the shared interactive Tooltip. Keep operators and
minimum-value constraints; omit only the redundant `In` prefix. Taints and
startup taints are separate groups; long values may wrap.

### Capacity

- Table **Usage** column sits before NodePool. NodePools show capacity ÷
  configured limits as `CPU n% / Mem n%` (same calculation as the Capacity
  section); other kinds show `-`. Missing usage or a missing/zero limit leaves
  that percentage unavailable.
- Memory and ephemeral storage use shared quantity parsing/formatting,
  including Kubernetes milli-byte quantities.
- CPU pairs (total/allocatable, total/limit) compare in whole cores when both
  are whole CPUs, otherwise both in millicores.
- The Capacity section is one small table for every Karpenter kind: one row per
  resource; **Allocatable** (when reported, NodeClaims) before an always-present
  **Capacity** column; **Limit** and **Used** after it when limits exist
  (NodePools). Missing source values show `-`. The table hugs its content, its
  first column matches the panel's label column, and it has no legend.
- **Used** = capacity ÷ limit for CPU and memory only, from parsed quantities
  before display rounding, up to one decimal. Values over 100% stay visible;
  omit when capacity is unavailable or the limit is zero.
- Usage and Used both use the warning text color strictly above 80%.
- Keep the header **Capacity**; its explanation tooltip belongs to the claim
  overview only (pools and overlays have none).
- Resource order: CPU, memory, storage, nodes, pods, pod-eni, hugepages, then
  others alphabetically. `ephemeral-storage` displays as `storage`,
  `vpc.amazonaws.com/pod-eni` as `pod-eni`; hugepage size suffixes stay.

### Condition Progress

NodeClaims and NodePools open with condition progress instead of a trailing
Conditions section. A track lists condition types in Karpenter's order: `True`
is completed, `False` failed, `Unknown`/missing pending. The earliest
incomplete step with a reason or message shows that explanation under the
steps; later messages are not repeated. A track renders only once one of its
prerequisite conditions is reported, so an object reporting only rolled-up
`Ready` keeps it as a chip.

- NodePool **Readiness**: ValidationSucceeded, NodeClassReady, Ready.
- NodeClaim **Provisioning**: Launched, Registered, Initialized, Ready.
  **Termination** (only when a termination condition exists): Drained,
  VolumesDetached, InstanceTerminating.
- Conditions outside rendered tracks (e.g. NodeRegistrationHealthy) stay
  `StatusChip`s: Drifted and DisruptionReason are warning when `True`,
  Consolidatable is info when `True`, all three healthy when `False`; others
  keep `True`=healthy, `False`=unhealthy, otherwise warning.

### Overviews

- NodePool reads top-down: Readiness and remaining chips; NodeClass / Weight /
  Replicas rows; Capacity with Limit and Used; then Scheduling, Disruption,
  and Lifecycle. No trailing Conditions section.
- NodeClaim reads top-down: Provisioning and Termination after the Status row,
  then remaining chips; NodePool, NodeClass, and Node link rows; one
  **Instance** row composing instance type, a capacity-type chip, and
  zone · architecture, followed by Provider ID and Image ID in monospace;
  Requirements, taints, and the expiry/grace-period **Lifecycle** section. No
  trailing Conditions or Provider sections.

## Argo CD

- Covers the namespaced `argoproj.io` Application, ApplicationSet, and
  AppProject CRDs only; other Argo products sharing `argoproj.io` are excluded.
  Namespace and All Namespaces views share one table; `namespace-argocd` has its
  own registered persistence key.
- Table columns separate Sync, Health, Project, Destination, and Target
  Namespace. Health and sync are independent backend projections (a synced
  Application can be degraded). ApplicationSet health follows ErrorOccurred and
  ResourcesUpToDate conditions; AppProject has no inferred health.
- Overview content: Application sources, destination, declared sync policy,
  deployed revisions, last operation; ApplicationSet generators, base template,
  and application-management policy; AppProject repositories, destinations,
  resource permissions, roles, and sync windows. Conditions use `StatusChip`
  with backend presentation. Raw Helm values and project JWT token metadata
  never enter display projections.
- Application layout: Health (chip, message beneath), Sync, **Last Sync** (last
  operation's phase chip via backend `phasePresentation`, started/finished from
  the shared local date formatter, operation message), Conditions; then rows
  for Project, Destination (name or resolved name with server beside it, else
  server alone), Namespace, ApplicationSet, Managed Resources.
- Source cards: title is name, else chart, else the repository's last path
  segment; path is meta; target revision is the tag; repository URL, chart
  (when titled by name), and ref are inner rows. Deployed revisions stay a
  separate labelled row because facts do not say which source each revision
  compared.
- Sync policy is one `Automated Sync` row (`Disabled`, or `Enabled` plus active
  prune / self heal / allow empty flags) plus sync options; Applications always
  show it, templates only when set.
- ApplicationSet: template identity (template name, project, destination,
  namespace, Go template) is a row block; generators are one-line cards (type,
  repository, revision); template sources, template sync policy, and management
  are peer sections.
- AppProject: source access rows; destination cards (name or server,
  namespace, server); resource-permission cards with Allowed/Denied rows; role
  cards; sync-window cards (kind, schedule · duration, time zone).
- ApplicationSet owner references keep their source GVK and the Application's
  namespace. Project names stay plain text: Applications can live outside the
  control-plane namespace, so their namespace cannot identify the AppProject.
  Destination names/servers are Argo CD targets, not Luxury Yacht cluster IDs;
  never turn them into local navigation by guessing a cluster.
- Destination name resolution (catalog row hydration and live Details): the
  request's cluster client lists only Secrets labelled
  `argocd.argoproj.io/secret-type=cluster` in `status.controllerNamespace`
  (else the object's namespace), never other namespaces or clusters. Lookups,
  successful or failed, are shared once per namespace per request with a
  two-second timeout; only decoded names and servers are kept. Explicit names,
  templates, and wildcard policies are unchanged; a denied read, unknown
  server, or conflicting registrations keep the URL. The implicit local
  destination becomes `in-cluster` after a successful lookup unless a
  registration renames it. Raw destination fields stay intact; `resolvedName`
  is display enrichment. The snapshot payload checksum changes the Details
  validator when a registration is renamed or access changes.

## cert-manager, External Secrets, Prometheus Operator

| Family | Namespaced kinds | Cluster kinds |
| --- | --- | --- |
| cert-manager | Certificate, CertificateRequest, Issuer, Order, Challenge | ClusterIssuer |
| External Secrets | ExternalSecret, SecretStore | ClusterExternalSecret, ClusterSecretStore |
| Prometheus Operator | ServiceMonitor, PodMonitor, PrometheusRule, Prometheus, Alertmanager | None |

Other kinds from these ecosystems keep the generic custom-resource view. API
sources: [cert-manager](https://cert-manager.io/docs/reference/api-docs/),
[External Secrets](https://external-secrets.io/main/api/spec/),
[Prometheus Operator](https://prometheus-operator.dev/docs/api-reference/api/).

- **cert-manager** tables show issuer/Secret links and expiration for
  namespaced resources, issuer type/server for ClusterIssuers. Details group
  validity, certificate identities and usages, private-key configuration,
  issuer settings, and ACME order/challenge progress. Denied
  CertificateRequests override Ready; ACME `ready` means progress, `valid`
  means ready. CSR, certificate, and ACME token/key material are excluded.
- **External Secrets** tables show provider, store, target Secret, and refresh
  interval. Details separate sync policy, remote key mappings, bulk sources,
  store namespace access, distribution failures, and template settings. Target
  names default to the generated ExternalSecret name. Template values and
  provider credentials are excluded; namespaced template references stay
  display values until there is a concrete namespace.
- **Prometheus Operator** tables show endpoint/rule counts, configured
  replicas, and version. Details separate target selectors, scrape endpoints,
  rule groups and expressions, instance settings, and resource selection.
  Empty and missing selectors keep distinct API semantics. Numeric ports and
  expressions project as display strings without changing sources; zero counts
  and replica settings stay visible. ServiceMonitor, PodMonitor, and
  PrometheusRule define no API status, so none is projected: the table Status
  cell shows the placeholder and Details has no Status row (pending deletion
  still reports Terminating). CRD configuration proves neither live scrape
  health nor firing alerts. Endpoint auth and remote-write credentials are
  excluded.
- ServiceMonitor/PodMonitor **Targets** rows: the selector row is labeled
  **Services** or **Pods** by kind (empty selector reads `All`);
  **Namespaces** resolves an empty namespace selector to the object's own
  namespace as `<name> (same namespace)`, lists `matchNames`, or reads
  `All namespaces`; then job label,
  sample/target limits (zero visible), and target/pod target labels.
- Each scrape endpoint is one card: title is the named port, or the numeric
  `targetPort`/`portNumber` with that field name as meta; scheme and path join
  the meta only when set (no invented defaults); interval and timeout form the
  right-aligned `every … · timeout …` tag; only remaining set fields (numeric
  target port beside a named port, honor labels, honor timestamps) become
  inner rows.
