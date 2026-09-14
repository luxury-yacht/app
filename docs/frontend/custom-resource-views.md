# Custom-resource views

Use the existing catalog, GridTable and Overview infrastructure when giving a
discovered CRD family dedicated presentation. Discovery, identity, visibility,
query boundaries and projection ownership follow the
[catalog contract](../architecture/catalog.md#discovered-resource-families).

## Presentation contracts

- Keep a single family table with the existing Kind filter. Do not introduce
  per-kind tabs to accommodate different fields.
- Give columns specific names and one fact per cell; CSV values must represent
  the same field. Put long configuration lists in Details.
- Use the shared Overview frame, kind-specific summaries and labeled sections.
  Omit empty sections and preserve meaningful zero values.
- Resource identifiers and values must remain selectable and copyable, including
  repeated lists and tooltip content. Check selection under the production
  `.app` CSS reset, including text-bearing descendants.
- Follow the Node panel's shared `StatusChip` pattern for Conditions and taints.
  Preserve condition-dependent colors and message/reason tooltips, and retain
  taint key/value/effect casing.

## Karpenter requirements

Keep the name **Requirements** to match YAML. Render source requirements,
including custom keys; do not hide a requirement because its key looks like a
metadata label. Show readable labels while keeping the exact key available in
the shared interactive Tooltip. Preserve operators and minimum-value constraints;
only the redundant `In` prefix is omitted. Taints and startup taints remain
separate groups, with long values allowed to wrap.

## Karpenter capacity

- The table Usage column sits before NodePool. For NodePools, show capacity divided
  by configured limits as `CPU n% / Mem n%`, using the same calculation as the Capacity section. Each
  percentage strictly above 80% uses the warning text color. Other kinds show `-`.
  A missing usage or missing/zero limit leaves that percentage unavailable.
- Use shared quantity parsing and formatting for memory and ephemeral storage,
  including Kubernetes milli-byte quantities.
- Compare CPU values using whole cores when both values are whole CPUs; otherwise
  use millicores for both. Apply this to total/allocatable and total/limit pairs.
- The Capacity section is one small table for every Karpenter kind: one row per
  resource, a **Capacity** column always, an **Allocatable** column before it when
  the object reports allocatable (NodeClaims), and **Limit** and **Used** columns
  after it when limits are configured (NodePools). A cell with no source value
  shows `-`. The table hugs its content rather than the panel width, and its first
  column matches the panel's label column. Do not add legends.
- **Used** is capacity divided by limit for CPU and memory only, calculated from
  parsed source quantities before display rounding, using up to one decimal place.
  Keep values over 100% visible, and use the warning text color strictly above 80%,
  the same rule as the table Usage column. Omit the value when capacity is
  unavailable or the limit is zero.
- Keep the header **Capacity**. The explanation tooltip belongs to the claim
  overview; pools and overlays do not supply it.
- Order resources as CPU, memory, storage, nodes, pods, pod-eni, hugepages, then
  other resources alphabetically. Display `ephemeral-storage` as `storage` and
  `vpc.amazonaws.com/pod-eni` as `pod-eni`; retain hugepage size suffixes.

## Karpenter condition progress

NodeClaims and NodePools open with their condition progress instead of a
trailing Conditions section. A progress track lists condition types in
Karpenter's order; a `True` condition is a completed step, `False` is a failed
step, and `Unknown` or missing is pending. The earliest incomplete step that
carries a reason or message is shown under the steps as the blocking
explanation; later steps' messages are not repeated. A track renders only once
one of its prerequisite conditions is reported, so an object that reports just
the rolled-up `Ready` keeps that condition as a chip. Conditions outside every
rendered track stay `StatusChip`s: Drifted and DisruptionReason use the warning
variant when `True`, Consolidatable uses info when `True`, and all three are
healthy when `False`; other conditions keep the default `True`=healthy,
`False`=unhealthy, otherwise warning.

- NodePool **Readiness**: ValidationSucceeded, NodeClassReady, Ready.
  NodeRegistrationHealthy and any other condition stay chips.
- NodeClaim **Provisioning**: Launched, Registered, Initialized, Ready.
  **Termination** appears only when a termination condition exists and lists
  Drained, VolumesDetached, InstanceTerminating.

## Karpenter NodePool overview

A pool reads top-down as readiness, source, provisioned capacity against limits,
then scheduling and disruption policy: Readiness and remaining condition chips,
NodeClass / Weight / Replicas rows, the Capacity table with Limit and Used
columns, then the Scheduling, Disruption and Lifecycle sections. No Conditions
section trails the pool view.

## Karpenter NodeClaim overview

A claim reads top-down as lifecycle, ownership, outcome, then capacity:

- Provisioning and Termination progress follow the Status row, then the
  remaining condition chips.
- NodePool, NodeClass and Node remain link rows. **Instance** composes the
  instance type, a capacity-type chip, and zone · architecture on one row,
  followed by Provider ID and Image ID in monospace. Requirements, taints and
  the expiry/grace-period **Lifecycle** section are unchanged.
- No Conditions or Provider sections trail the claim view.

The owning implementations are
[KarpenterSections.tsx](../../frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/KarpenterSections.tsx),
[KarpenterProgress.tsx](../../frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/KarpenterProgress.tsx),
the shared [capacity formatter](../../frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/karpenterCapacityFormat.ts),
the [overview descriptor](../../frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/karpenter.tsx)
and [column factory](../../frontend/src/modules/cluster/components/karpenterColumns.tsx).

## Validation

Use realistic long values, sparse objects and narrow panels to review layout.
Exercise selection, copy and tooltip keyboard access directly; screenshots do not
prove those interactions. Keep regression tests focused on application behavior,
rather than adding assertions for individual labels or CSS properties. Follow the
[completion evidence contract](../workflows/completion.md) and distinguish
Storybook fixture previews from live-cluster and native Wails validation.

## Argo CD

Argo CD uses the namespaced `argoproj.io` Application, ApplicationSet, and
AppProject CRDs. The namespace and All Namespaces views use one table and the
existing Kind filter. Discovery gates the sidebar and command palette; empty
installations remain available. Other Argo products sharing `argoproj.io` do
not belong to this family.

The table separates Sync, Health, Project, Destination, and Target Namespace.
Health and sync are independent backend projections; a synced Application can
be degraded. ApplicationSet health follows ErrorOccurred and ResourcesUpToDate
conditions. AppProject policy has no inferred health. Production column builders
own auto-sizing, and `namespace-argocd` has its own registered persistence key.

Overviews show Application sources, destination, declared sync policy, deployed
revisions and last operation; ApplicationSet generators, base application
template and application-management policy; and AppProject repositories,
destinations, resource permissions, roles and sync windows. Conditions use the
shared StatusChip with backend presentation. Values remain selectable. Raw Helm
values and project JWT token metadata stay out of these display projections.

Status and conditions lead the detail content. Source cards show target revisions;
deployed revisions remain a labelled group alongside them because the facts do
not identify which source was compared for each revision. ApplicationSet template
identity, sources, sync policy, and management are peer sections. AppProject access rules are grouped
by source access, destination, resource scope, role, and sync window. Repeated
entries have titles, and policy lists and messages have labels and full-width
content. Operation timestamps use the shared local date formatter.

ApplicationSet owner references preserve their source GVK and the Application's
namespace. Project names remain plain text: Applications can live outside the
Argo CD control-plane namespace, so their own namespace cannot identify the
AppProject. Destination names and servers are Argo CD targets, not Luxury Yacht
cluster IDs; do not turn them into local navigation by guessing a cluster.

Catalog row hydration and live Details optionally resolve a destination server
to the name registered in Argo CD. The request's cluster client lists only
Secrets labelled `argocd.argoproj.io/secret-type=cluster` in
`status.controllerNamespace`, falling back to the object's namespace when that
field is absent. It never searches other namespaces or Luxury Yacht clusters.
Successful and failed lookups are shared once per namespace within the request,
with a two-second timeout; only decoded names and servers are retained.
Explicit destination names, templates, and wildcard policies remain unchanged.
A denied read, unknown server, or conflicting registrations preserves the URL.
The implicit local destination uses `in-cluster` after a successful lookup unless
a registration overrides its name. Raw destination fields remain intact;
`resolvedName` is display enrichment. The existing snapshot payload checksum
changes the Details validator when a registration is renamed or access changes.

## Certificate, secret synchronization, and monitoring operators

The following dedicated views use one family table with the existing Kind
filter, independent persistence per scope, and discovery-gated sidebar and
command-palette entries:

| Family | Namespaced kinds | Cluster kinds |
| --- | --- | --- |
| cert-manager | Certificate, CertificateRequest, Issuer, Order, Challenge | ClusterIssuer |
| External Secrets | ExternalSecret, SecretStore | ClusterExternalSecret, ClusterSecretStore |
| Prometheus Operator | ServiceMonitor, PodMonitor, PrometheusRule, Prometheus, Alertmanager | None |

Other kinds from these ecosystems retain the generic custom-resource view.
API sources: [cert-manager](https://cert-manager.io/docs/reference/api-docs/),
[External Secrets](https://external-secrets.io/main/api/spec/), and
[Prometheus Operator](https://prometheus-operator.dev/docs/api-reference/api/).

cert-manager tables show issuer/Secret links and expiration for namespace
resources, and issuer type/server for ClusterIssuers. Details group validity,
certificate identities and usages, private-key configuration, issuer settings,
and ACME order/challenge progress. Denied CertificateRequests override Ready;
ACME `ready` means progress, while `valid` means ready. CSR, certificate, and
ACME token/key material are excluded from display facts.

External Secrets tables show provider, store, target Secret, and refresh
interval. Details separate synchronization policy, remote key mappings, bulk
sources, store namespace access, distribution failures, and template settings.
Target-name defaults follow the generated ExternalSecret name. Template values
and provider credentials are excluded; namespaced template references remain
display values until there is a concrete namespace.

Prometheus Operator tables show endpoint/rule counts, configured replicas, and
version. Details separate target selectors, scrape endpoints, rule groups and
expressions, instance settings, and resource selection. Empty selectors and
missing selectors retain distinct API semantics. Numeric ports and expressions
are projected as display strings without changing source objects. Zero counts
and replica settings remain visible. Config objects without status have no
inferred health; CRD configuration does not establish live scrape health or
whether an alert is firing. Endpoint authentication and remote-write credentials
are excluded from these projections.

ServiceMonitor and PodMonitor details use label/value rows for **Targets**: the
selector row is labeled **Services** or **Pods** by kind (an empty selector reads
`All`), **Namespaces** resolves the empty namespace selector to the object's own
namespace as `<name> (same namespace)`, lists `matchNames`, or reads
`All namespaces`; job label, sample/target limits (zero stays visible) and
target/pod target labels follow. Each scrape endpoint is one card: the title is
the named port, or the numeric `targetPort`/`portNumber` with that field name as
the card meta; scheme and path appear in the meta only when set (defaults are not
invented); interval and timeout form the right-aligned `every … · timeout …` tag;
only the remaining set fields (a numeric target port alongside a named port,
honor labels, honor timestamps) render as rows inside the card.

The shared operator overview uses the existing Overview and StatusChip patterns,
selectable values, titled repeated entries, and full-width messages. It adds no
operator-specific actions or graph topology.
