# Gateway API Support — Design

Status: design approved 2026-04-25 — implementation pending.

## Goal

Add first-class support to Luxury Yacht for Kubernetes Gateway API resources, at parity
with the existing `Ingress` treatment: typed details panes, Network-tab integration,
status surfacing, and clickable cross-object navigation.

## Scope

Resources covered (all under `gateway.networking.k8s.io/v1`):

| Kind               | Scope      |
| ------------------ | ---------- |
| `GatewayClass`     | cluster    |
| `Gateway`          | namespaced |
| `ListenerSet`      | namespaced |
| `HTTPRoute`        | namespaced |
| `GRPCRoute`        | namespaced |
| `TLSRoute`         | namespaced |
| `BackendTLSPolicy` | namespaced |
| `ReferenceGrant`   | namespaced |

Out of scope for v1: `TCPRoute`, `UDPRoute` (the Helm test chart includes them, but the
upstream project does not list them in the supported v1 set we are targeting).

## Architectural decisions

The decisions below are settled. They constrain everything in the rest of this
document.

1. **Typed client.** Add `sigs.k8s.io/gateway-api` (latest stable v1.5.x) and consume
   the typed clientset / informer factory / listers, mirroring how `networkingv1.Ingress`
   is consumed today. The `unstructured` path was rejected — it is far more verbose and
   error-prone for the field depth we want to surface (per-listener conditions,
   parent-status conditions, ref structures across 8 kinds).
2. **Discovery-gated registration.** Gateway API CRDs are not installed by default.
   On cluster init we read the existing `apiextensions` CRD lister and only register
   the typed informer factory + per-kind listers when at least one Gateway-API CRD is
   present. Per-kind listers are nil when their CRD is absent. Mid-session CRD
   installation is not picked up live; the user reconnects.
3. **Feature parity with `Ingress`.** Each kind gets a typed `*Details` builder, full
   typed detail tab in the object panel, YAML/delete via the existing generic plumbing.
4. **UI placement.** Namespaced kinds appear on the Namespace Network tab alongside
   `Service`/`Ingress`/`NetworkPolicy`/`EndpointSlice`. `GatewayClass` appears under
   Cluster Config alongside `IngressClass`. No new tab.
5. **Status surfacing depth — headline conditions.** Show top-level `addresses` (where
   applicable) plus the canonical `metav1.Condition` entries per kind, rendered as
   compact status pills (Ready / Pending / Failed / Unknown + Reason + Message
   tooltip). Listener-level status is collapsed to a count summary
   ("2/3 listeners programmed") with click-to-expand. Per-listener and per-parent
   tables are a documented follow-up, not v1.
6. **Cross-references are clickable everywhere.** Every `parentRef`, `backendRef`,
   `gatewayClassName`, `targetRef`, and CACertificateRef in the typed detail panes is
   a link that opens the referenced object in the panel (or navigates to the
   appropriate cluster-scope view).
7. **Single-landing rollout.** All eight kinds delivered in one feature branch / one
   PR, end-to-end. Phased rollout was rejected to avoid an intermediate "appears in
   list but only shows generic YAML" UX gap.

## Architecture overview

### Module layout

A net-new backend package, sibling to `backend/resources/network/`:

```
backend/resources/gatewayapi/
  service.go             — Service struct + Deps wiring
  conditions.go          — summarizeConditions, ConditionState helpers
  refs.go                — typed→ObjectRef / RefOrDisplay adapters
  gateway.go             — Service.Gateway, Service.Gateways, buildGatewayDetails
  httproute.go
  grpcroute.go
  tlsroute.go
  gatewayclass.go        — cluster-scoped variant
  listenerset.go
  referencegrant.go
  backendtlspolicy.go
  *_test.go              — sibling tests for every file
```

Frontend additions land in existing modules — no new top-level frontend module:

- `frontend/src/modules/object-panel/components/ObjectPanel/Details/` — eight new
  `*DetailsTab.tsx` components (one per kind).
- `frontend/src/shared/components/StatusPill.{tsx,css}` — new shared primitive for
  rendering a `ConditionState`.
- Extensions to the existing `frontend/src/shared/components/ObjectPanelLink.tsx`
  to accept either an `ObjectRef` (always navigable) or a `RefOrDisplay` (the
  `Display` branch renders as plain text; the `Ref` branch is navigable).
  No new parallel navigation primitive.
- Edits to `kindAliasMap.ts`, `kindViewMap.ts`, `builtinGroupVersions.ts`,
  `permissionSpecs.ts`, `catalog.ts`, `CommandPaletteCommands.tsx`,
  `NsViewNetwork.tsx`, `ClusterResourcesContext.tsx`, `ClusterResourcesManager.tsx`.

### Dependency

Add to `go.mod`:

- `sigs.k8s.io/gateway-api/apis/v1`
- `sigs.k8s.io/gateway-api/pkg/client/clientset/versioned`
- `sigs.k8s.io/gateway-api/pkg/client/informers/externalversions`
- `sigs.k8s.io/gateway-api/pkg/client/listers/gateway/v1`

Pin to the latest stable release (currently v1.5.x). The module is CNCF-stable and
released alongside the CRDs themselves.

### Discovery and dependency wiring

`gatewayapi.Discover(ctx, crdLister) GatewayAPIPresence` reads the existing
`CustomResourceDefinitionLister` and returns:

```go
type GatewayAPIPresence struct {
    Gateway          bool
    GatewayClass     bool
    HTTPRoute        bool
    GRPCRoute        bool
    TLSRoute         bool
    ListenerSet      bool
    ReferenceGrant   bool
    BackendTLSPolicy bool
}

func (p GatewayAPIPresence) AnyPresent() bool { /* … */ }
```

Called once during `cluster_clients.go` setup, after the apiext factory has synced.
The result is stored on the per-cluster `Deps` bundle alongside permissions and is
threaded into:

- `objectcatalog.Service` — informer registry conditionally adds the eight typed
  listers.
- `refresh.System.Manager` — snapshot domain registration AND's presence with
  permissions to decide which `Include*` flags to set.
- `resources/gatewayapi.Service` — uses the Gateway-API client directly. Each
  handler returns `ErrGatewayAPINotInstalled` if either the client is nil
  _or_ the per-kind presence flag for that handler's kind is false. See
  "Resource handlers" below for the full check.

When `presence.AnyPresent()` is true, a single `gatewayinformers.SharedInformerFactory`
is constructed in `cluster_clients.go` (next to the existing `dynamic.NewForConfig`)
and stored on the per-cluster bundle. Per-kind listers within the factory are wired
only for present kinds.

## Backend components

### Types

In `backend/resources/types/types.go`, with re-exports in `backend/types.go`:

**Shared building blocks** (used across multiple kinds):

```go
type ObjectRef struct {
    ClusterID string `json:"clusterId"`
    Group     string `json:"group"`
    Version   string `json:"version"`               // always non-empty
    Kind      string `json:"kind"`
    Namespace string `json:"namespace,omitempty"`
    Name      string `json:"name"`
}

// DisplayRef is used for refs whose API version cannot be proven on this
// cluster. It is *not* navigable; the frontend renders it as plain text.
// It exists as a separate type so ObjectRef can remain strictly valid per
// the AGENTS.md hard rule (every ObjectRef carries clusterId+group+kind+
// version).
type DisplayRef struct {
    ClusterID string `json:"clusterId"`
    Group     string `json:"group"`
    Kind      string `json:"kind"`
    Namespace string `json:"namespace,omitempty"`
    Name      string `json:"name"`
}

type ConditionState struct {
    Status  string `json:"status"`              // "True" | "False" | "Unknown"
    Reason  string `json:"reason,omitempty"`
    Message string `json:"message,omitempty"`
}

type ConditionsSummary struct {
    Programmed     *ConditionState `json:"programmed,omitempty"`
    Accepted       *ConditionState `json:"accepted,omitempty"`
    ResolvedRefs   *ConditionState `json:"resolvedRefs,omitempty"`
    SupportedFeatures *ConditionState `json:"supportedFeatures,omitempty"`
}
```

`ObjectRef` carries cluster ID + GVK so cross-cluster object identity is unambiguous,
per the AGENTS.md hard rule.

**Version resolution rule.** Gateway API refs (`ParentReference`, `BackendRef`,
`LocalObjectReference`, `BackendObjectReference`, etc.) carry only `group` / `kind`
/ `name` / (`namespace`) — no API version. The backend `refs.go` adapter resolves
the version before emitting the typed payload, in this order, and emits _either_
an `ObjectRef` (resolved, navigable) _or_ a `DisplayRef` (unresolved, plain text):

1. **Hardcoded defaults for known refs.** Emit `ObjectRef`.
   - Empty group + `Service` / `ConfigMap` / `Secret` → `"v1"`.
   - `gateway.networking.k8s.io` + any in-scope kind → `"v1"`.
2. **Catalog lookup** for arbitrary group/kind: query the existing object-catalog
   for the discovered preferred served version of the GVK. If the catalog
   resolves the GVK to exactly one served version, emit `ObjectRef` with that
   version. If the lookup is ambiguous (multiple served versions and no
   discovery preference is recorded) or absent, fall through to step 3.
3. **Unresolved fallback.** If neither rule resolves a version, emit `DisplayRef`
   instead. The detail-pane field type is `RefOrDisplay { Ref *ObjectRef;
Display *DisplayRef }` (exactly one populated); the typed-detail Go structs
   use this wrapper everywhere a Gateway-API ref appears. The frontend
   `ObjectPanelLink` extension (see "Typed detail tabs" below) renders the
   `Display` branch as plain text with a tooltip explaining the GVK is not
   discoverable on this cluster.

The adapter is exercised by `refs_test.go` covering all three branches.

**Per-kind detail structs** (one each), each carrying the standard envelope fields
(`Kind`, `Name`, `Namespace`, `Age`, `Labels`, `Annotations`, `Details` summary
string) plus kind-specific fields:

Ref fields use one of two types depending on whether their version can always
be resolved:

- `ObjectRef` — used where the GVK is fixed by spec (e.g. `GatewayClass`, the
  built-in core kinds). Always navigable.
- `RefOrDisplay { Ref *ObjectRef; Display *DisplayRef }` (exactly one
  populated) — used for Gateway-API ref types that permit arbitrary group/kind
  (`parentRefs`, `backendRefs`, `targetRefs`, `RouteParentStatus.parent`,
  `PolicyAncestorStatus.ancestor`).

Per-kind structs:

- `GatewayDetails` — `GatewayClassRef ObjectRef` (always resolves;
  spec.gatewayClassName + the fixed Gateway-API group/version),
  `Listeners []GatewayListener`, `Addresses []GatewayAddress`,
  `ConditionsSummary`, `ListenerStatusCounts string` ("2/3 programmed").
- `GatewayListener` — `Name`, `Port`, `Protocol`, `Hostname`, `TLSMode`,
  `AllowedRoutesSummary string`, `ConditionsSummary`.
- `GatewayAddress` — `Type`, `Value`.
- `HTTPRouteDetails` / `GRPCRouteDetails` / `TLSRouteDetails` — `Hostnames []string`,
  `ParentRefs []RefOrDisplay`, `Rules []RouteRule`, `ParentStatuses []RouteParentStatus`.
- `RouteRule` — `MatchSummary string`, `BackendRefs []BackendRef`.
- `BackendRef` — `Ref RefOrDisplay`, `Weight int32`, `Port int32`.
- `RouteParentStatus` — `Parent RefOrDisplay`, `Conditions ConditionsSummary`.
- `GatewayClassDetails` — `ControllerName`, `Description`, `ConditionsSummary`,
  `UsedBy []ObjectRef` (Gateways referencing this class — fixed group/version).
- `ListenerSetDetails` — `ParentRef ObjectRef` (Gateway, fixed group/version),
  `Listeners []GatewayListener`, `ConditionsSummary`.
- `ReferenceGrantDetails` — `From []ReferenceGrantFrom` (group/kind/namespace
  tuples — these describe ref _classes_, not specific objects, so they are
  not navigable), `To []ReferenceGrantTo` where `ReferenceGrantTo` is
  `{ Group, Kind string; Target *RefOrDisplay }`. When the spec entry has no
  `name`, `Target` is nil and the UI renders a class tuple. When `name` is
  set, the adapter emits a `RefOrDisplay` with the ReferenceGrant's own
  namespace as the target namespace (per the Gateway API spec — the grant
  authorizes refs _into_ its namespace).
- `BackendTLSPolicyDetails` — `TargetRefs []RefOrDisplay`,
  `Validation BackendTLSValidation`, `AncestorStatuses []PolicyAncestorStatus`.
- `BackendTLSValidation` — `CACertificateRefs []ObjectRef` (ConfigMap/Secret,
  fixed core/v1 group/version), `Hostname string`, `WellKnownCACerts string`.
- `PolicyAncestorStatus` — `Ancestor RefOrDisplay`, `ControllerName string`,
  `Conditions ConditionsSummary` (Accepted, ResolvedRefs).

### Resource handlers — `backend/resources/gatewayapi/`

`Service` constructed from existing `Deps`. Per kind, two methods (matching
`network.Service.Ingress`/`Ingresses` shape):

```go
func (s *Service) Gateway(ns, name string) (*types.GatewayDetails, error)
func (s *Service) Gateways(ns string)     ([]*types.GatewayDetails, error)
```

Cluster-scoped kinds drop the `ns` parameter. Each handler:

1. Returns `ErrGatewayAPINotInstalled` if `s.deps.GatewayClient == nil` **or** if
   the per-kind presence flag for this handler's kind is false (e.g.
   `Gateway` handler checks `s.deps.GatewayAPIPresence.Gateway`). This prevents
   the partial-presence case where one CRD is installed (so the client is
   non-nil) but the user opens a different, absent kind — without the per-kind
   check the typed `Get` would surface a generic server `NotFound` instead of
   the "not installed" path.
2. Calls the typed clientset (`s.deps.GatewayClient.GatewayV1().Gateways(ns).Get(...)`).
3. Hands the typed object to `buildGatewayDetails` which assembles the typed
   `*GatewayDetails` payload, including `summarizeConditions` calls for the
   relevant condition names.

`conditions.go` provides:

```go
func summarizeConditions(conds []metav1.Condition, names ...string) ConditionsSummary
```

`refs.go` provides typed-to-`ObjectRef` / `RefOrDisplay` adapters for
`gatewayv1.ParentReference`, `gatewayv1.BackendRef`,
`gatewayv1.LocalObjectReference`, etc., propagating cluster ID from the
surrounding `Deps` and applying the version-resolution rule above to choose
between emitting an `ObjectRef` (resolved) or a `DisplayRef`-bearing
`RefOrDisplay` (unresolved).

### Informer / lister wiring

Two existing files extended:

- `backend/objectcatalog/informer_registry.go` — extends the `sharedInformerListers`
  map with eight new entries, conditionally registered based on
  `GatewayAPIPresence`. Adds a `gatewayinformers.SharedInformerFactory` parameter
  to the constructor.
- `backend/refresh/informer/factory.go` — extends `Factory` with
  `gatewayFactory gatewayinformers.SharedInformerFactory`; `Start()` starts both
  factories; `WaitForCacheSync` waits on both. Tolerates a nil `gatewayFactory`.

The Gateway-API factory is constructed in `cluster_clients.go` next to the existing
`dynamic.NewForConfig` call, gated on `presence.AnyPresent()`.

### Snapshot domain integration

No new domain registered. Two existing domains extended:

- `namespace_network.go` — `NamespaceNetworkPermissions` gains seven new
  `IncludeXxx` fields (one per namespaced Gateway-API kind);
  `NamespaceNetworkBuilder` gains seven new lister fields. `Build()` runs seven
  new branches that produce `NetworkSummary` rows with `Kind` set to the
  Gateway-API kind name. The `Details` summary string is built per kind:
  - `Gateway`: `"Listeners: N"` + `", LB: <addr>"` if present.
  - Routes: `"Hosts: <first>"` + `", Backends: N"`.
  - `ListenerSet`: `"Parent: <gateway-name>, Listeners: N"`.
  - `ReferenceGrant`: `"From: N, To: M"`.
  - `BackendTLSPolicy`: `"Targets: N"`.
- `cluster_config.go` — `ClusterConfigPermissions` gains
  `IncludeGatewayClasses`. `streaming_helpers.go` gains
  `BuildClusterGatewayClassSummary` mirroring `BuildClusterIngressClassSummary`.

`permission_checks.go` gains entries for `gateway.networking.k8s.io` /
`gateways`, `httproutes`, `grpcroutes`, `tlsroutes`, `gatewayclasses`,
`listenersets`, `referencegrants`, `backendtlspolicies` — feeding into the
existing permission-gate flow. The `IncludeXxx` flags are AND'd against
discovery presence, so a permission-denied row is emitted via the existing
`RegisterPermissionDeniedDomain` only when the CRD is present but list is
denied.

### Object-detail routing

`backend/refresh/snapshot/object_details.go` — eight new entries to the
kind→builder map, mirroring the `"ingress"` and `"ingressclass"` cases. Lookup
keys use the existing lower-cased Kind alias system (`gateway`, `httproute`,
`grpcroute`, `tlsroute`, `gatewayclass`, `listenerset`, `referencegrant`,
`backendtlspolicy`). Cluster-scoped `gatewayclass` follows the cluster-scoped
path used by `ingressclass`.

`backend/object_detail_provider.go` — same extension, plus eight cache-key
namespace entries (`objectDetailCacheKey("Gateway", ...)`, etc.).

`backend/response_cache_invalidation.go` — eight new kind entries in the
watch-event invalidation routing table. `Gateway` and `HTTPRoute` watch events
also invalidate any cached `GatewayClass` detail, mirroring how `Ingress`
events invalidate `IngressClass` cached details today (the cached details
include a `UsedBy` list).

### App wrappers — `backend/resources_gatewayapi.go` (new)

Wails-exposed thin wrappers, mirroring the shape of `resources_helm.go` and
`resources_network.go`:

- `App.GetGatewayDetails(clusterID, namespace, name) (*GatewayDetails, error)`
- `App.ListGateways(clusterID, namespace) ([]*GatewayDetails, error)`
- … and the equivalent for the other seven kinds (cluster-scoped kinds drop
  the `namespace` parameter; total 16 methods).

Each uses `FetchNamespacedResource` / `FetchClusterScopedResource` for cache,
selection-key, and permission integration.

## Frontend components

### Kind / permission registration (mechanical)

- `frontend/src/utils/kindAliasMap.ts`: `Gateway: 'gw'`, `HTTPRoute: 'httproute'`,
  `GRPCRoute: 'grpcroute'`, `TLSRoute: 'tlsroute'`, `GatewayClass: 'gwclass'`,
  `ListenerSet: 'lset'`, `ReferenceGrant: 'refgrant'`, `BackendTLSPolicy: 'btlsp'`
  (plus reverse mappings).
- `frontend/src/utils/kindViewMap.ts`: namespaced kinds → `'network'`;
  `GatewayClass` → `'cluster-config'`.
- `frontend/src/shared/constants/builtinGroupVersions.ts`: register
  `gateway.networking.k8s.io/v1` for each kind.
- `frontend/src/core/capabilities/{catalog.ts,permissionSpecs.ts}`: register the
  eight kinds with list/watch/get/delete verbs, mirroring the `Ingress` /
  `IngressClass` entries. CRD-not-installed is reflected as a permission-denied
  with a distinct "not installed" reason.
- `frontend/src/ui/command-palette/CommandPaletteCommands.tsx`: add the eight
  kinds to the kind-jump command list.

### Network tab

`frontend/src/modules/namespace/components/NsViewNetwork.tsx` — minimal change.
The view already filters by Kind against an `availableKinds` array supplied by
the backend snapshot. Once Section "Snapshot domain integration" emits the new
rows and the kind maps know about them, the existing Kind filter, column
factories, and "Details" column pick them up automatically. Confirm
`useNamespaceFilterOptions` propagates the new kinds.

### Cluster Config row (`GatewayClass`)

`frontend/src/modules/cluster/contexts/ClusterResourcesContext.tsx` and
`ClusterResourcesManager.tsx` — verbatim mirror of the existing `IngressClass`
wiring: a `configGatewayClassPermission = useUserPermission('GatewayClass', ...)`,
include `GatewayClass` in the cluster-config kinds list.

### Typed detail tabs

Eight new components in
`frontend/src/modules/object-panel/components/ObjectPanel/Details/`,
registered in `detailsTabTypes.ts`. Each is structurally similar to
`IngressDetailsTab.tsx` (header with Name/NS/Age/Kind, "Details" summary block,
kind-specific sections).

Two new shared primitives:

- `frontend/src/shared/components/StatusPill.{tsx,css}` — renders a
  `ConditionState` as a coloured pill (Ready / Pending / Failed / Unknown),
  with the Reason as the visible label and Message in a tooltip. Theme tokens
  for Light and Dark.
- `frontend/src/shared/components/ObjectPanelLink.tsx` — extended (not
  duplicated) to accept either an `ObjectRef` or a `RefOrDisplay`. For an
  `ObjectRef` (or the `Ref` branch of a `RefOrDisplay`), behavior is unchanged:
  navigates via `openWithObject` / `useNavigateToView`. For the `Display`
  branch of a `RefOrDisplay`, the link renders as plain text with a tooltip
  ("API version for {Group}/{Kind} is not discoverable on this cluster"). The
  existing disabled-rendering path covers the cross-namespace / denied / stale
  cases ("Object not accessible in current view").

Per-kind tab content:

- **GatewayDetailsTab** — `GatewayClassRef` as `ObjectPanelLink`, `Addresses`
  (type/value chip list), two pills for `Programmed` and `Accepted`,
  `Listeners` section listing each listener (name/port/protocol/hostname) with
  per-listener status collapsed to "X/Y programmed" and click-to-expand
  revealing per-listener pills.
- **HTTPRouteDetailsTab / GRPCRouteDetailsTab / TLSRouteDetailsTab** —
  `Hostnames`, `ParentRefs` rendered as `ObjectPanelLink` chips, `ParentStatuses`
  as a row per parent with two pills (`Accepted`, `ResolvedRefs`), `Rules` as
  a list — each rule shows its match summary string and `BackendRefs` as
  `ObjectPanelLink`s.
- **GatewayClassDetailsTab** — `Controller`, `Description`, two pills for
  `Accepted` and `SupportedFeatures`, `UsedBy` as `Gateway` `ObjectPanelLink`
  chips.
- **ListenerSetDetailsTab** — `ParentRef` as `ObjectPanelLink`, `Listeners` block
  (same renderer as `GatewayDetailsTab`'s listener block), `ConditionsSummary`.
- **ReferenceGrantDetailsTab** — two columns: `From` (group/kind/namespace
  tuples, plain text) and `To` (group/kind, with the optional named target
  rendered as `ObjectPanelLink` over the entry's `Target *RefOrDisplay` —
  navigable when the version resolves, plain text via the `Display` branch
  otherwise). When `Target` is nil the row shows the class tuple alone.
- **BackendTLSPolicyDetailsTab** — `TargetRefs` as `ObjectPanelLink`s,
  `Validation` block (`CACertificateRefs` as `ObjectPanelLink`s to ConfigMaps /
  Secrets, `Hostname`, `WellKnownCACerts`), `AncestorStatuses` as a row per
  ancestor with two pills (`Accepted`, `ResolvedRefs`) — same renderer used by
  Routes' `ParentStatuses` block.

### Refresh wiring

No new `RefreshDomain` entry. Refresh is already on `namespace-network` and
`cluster-config`; only the rows inside those payloads change. Per
`frontend/AGENTS.md`, no ad-hoc fetch — all data flows through the existing
refresh client. Diagnostics panel config in `diagnosticsPanelConfig.ts` is
per-domain, not per-Kind, and does not need changes.

### Detail-tab data path

Detail tabs do **not** call the Wails-generated `App.GetGatewayDetails` etc.
functions directly. Doing so would bypass the `object-details` refresh domain
that the existing `ObjectPanel` already drives — losing diagnostics state, the
response cache integration described in "Cache invalidation" below, and
active-tab polling.

Instead, the detail-tab payloads ride the existing `object-details` scoped
refresh domain:

- The `App` wrappers from "App wrappers" above are the data source the
  domain provider calls; they are **not** invoked from React.
- `backend/refresh/snapshot/object_details.go` and
  `backend/object_detail_provider.go` (already extended in "Object-detail
  routing") plug each Gateway-API kind into the existing kind-keyed dispatch
  table. The provider returns the typed `*GatewayDetails` etc. payload to the
  domain.
- The frontend `object-details` refresh domain (see
  `frontend/src/core/refresh/types.ts:447` and `:741`) gains new payload-shape
  variants in `ObjectDetailsSnapshotPayload` for the eight kinds.
- The eight `*DetailsTab` components consume their typed payload from the
  refresh store via the same hook the existing `IngressDetailsTab` uses — no
  new fetch path, no new Wails calls from the detail tabs.

## Data flows

### Cluster init

```
cluster_clients.go: ClusterClients.New(ctx, kubeconfig, ...)
  ├─ kubeClient = kubernetes.NewForConfig(...)
  ├─ apiextClient = apiextensionsclient.NewForConfig(...)
  ├─ dynamicClient = dynamic.NewForConfig(...)
  ├─ apiextFactory.Start(); WaitForCacheSync       ← CRD lister populated
  ├─ presence = gatewayapi.Discover(ctx, crdLister)
  └─ if presence.AnyPresent():
        gwClient  = gatewayversioned.NewForConfig(...)
        gwFactory = gatewayinformers.NewSharedInformerFactory(gwClient, resync)
        — register only listers for kinds where presence[Kind] == true
        gwFactory.Start(); WaitForCacheSync (per-kind)
     else:
        gwClient, gwFactory = nil, nil
```

`presence` and `gwClient` are stored on the per-cluster `Deps` bundle and
threaded into `objectcatalog.Service`, `refresh.System.Manager`, and
`resources/gatewayapi.Service`.

### Namespace Network tab read

```
User opens Network tab on namespace foo
  → frontend RefreshManager triggers domain "namespace-network"
  → backend dispatches to NamespaceNetworkBuilder.Build(ctx, "cluster:c1/namespace:foo")
  → builder reads its 11 listers (4 existing + 7 new); nil listers skipped
  → results merged into []NetworkSummary, sorted, truncated at 1000, kinds list aggregated
  → snapshot returned; frontend GridTable renders, Kind filter populated from snapshot.Kinds
```

Streaming (SSE) refresh path is identical — the existing `namespace-network`
streaming wiring picks up the additional kinds with no transport changes.

### Open detail pane (e.g. Gateway)

```
User clicks a row with Kind=Gateway, Name=demo, NS=foo
  → ObjectPanel opens; subscribes to the object-details scoped refresh domain
    keyed by ("c1","Gateway","foo","demo")
  → frontend RefreshManager triggers /api/v2/refresh/object-details for that scope
  → backend object_details domain dispatches via the kind-keyed table to the
    gateway provider entry
  → resources_gatewayapi.go → FetchNamespacedResource(...)
       ├─ checks responseCache for ("Gateway","foo","demo") under selection key
       ├─ on miss: gatewayapi.Service.Gateway("foo","demo")
       │     → presence + nil-client check (returns ErrGatewayAPINotInstalled
       │       if either fails)
       │     → gwClient.GatewayV1().Gateways("foo").Get(ctx, "demo", ...)
       │     → buildGatewayDetails(*v1.Gateway) → *GatewayDetails
       └─ stores in responseCache, returns
  → ObjectDetailsSnapshotPayload (Gateway variant) lands in the refresh store
  → GatewayDetailsTab renders from the refresh store via the same hook
    IngressDetailsTab uses; ObjectPanelLink for GatewayClassRef navigates to
    cluster-config view + opens GatewayClass in panel
```

### Cache invalidation

`response_cache_invalidation.go` already routes watch events from the dynamic
informer through a kind→invalidator map. Eight new entries, each invalidating
its own cached detail key. `Gateway` and `HTTPRoute` watch events additionally
invalidate the cached `GatewayClass` detail (whose `UsedBy` list depends on
those kinds).

### Cluster reconnect / mid-session CRD install

The existing reconnect path (`app_refresh_recovery.go` →
`cluster_clients.go` rebuild) re-runs the full init sequence, so a
freshly-installed Gateway-API CRD becomes visible after the user reconnects.
v1 does **not** watch the CRD lister for additions; that is a documented
follow-up if it proves to be a real friction point.

## Error handling

| Condition                                                                                  | Behavior                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All Gateway-API CRDs absent                                                                | `presence.AnyPresent()=false` → `gwClient=nil`, no listers registered, no rows emitted, no permission-denied entries. Capability map reports each kind as "not installed" (distinct from "denied"); frontend renders an explanatory empty state if the user navigates by URL. |
| One CRD present, others absent                                                             | Per-kind. Listers wired only for present kinds; absent kinds behave as the row above.                                                                                                                                                                                         |
| CRD present, list/watch denied                                                             | Existing `RegisterPermissionDeniedDomain` pattern emits a `PermissionIssue` per-kind for the namespace-network domain; UI shows the same banner it does for denied `Ingress`.                                                                                                 |
| `gwClient.Get` returns `NotFound`                                                          | `FetchNamespacedResource` returns the error; ObjectPanel renders the existing "object not found" empty state.                                                                                                                                                                 |
| `gwClient.Get` returns `Forbidden`                                                         | Wrapped per existing convention; ObjectPanel renders the existing permission-error state.                                                                                                                                                                                     |
| Informer cache out of sync after `Start`                                                   | Same timeout behavior as the existing built-in informer `WaitForCacheSync` — logged, builder still runs but with empty results until sync completes.                                                                                                                          |
| `ObjectRef` target unresolvable (cross-namespace, denied, stale)                           | `ObjectPanelLink` renders disabled with tooltip "Object not accessible in current view." No navigation.                                                                                                                                                                       |
| `metav1.Condition` slice empty or named condition not present                              | `summarizeConditions` returns `nil` for that condition; `StatusPill` renders as `Unknown` (grey).                                                                                                                                                                             |
| Installed CRD version drift vs. Go module (e.g. cluster has v1.6 CRDs, our client is v1.5) | Typed client tolerates additional fields per K8s API conventions; we log a single warning at startup if the discovered CRD `storedVersions` doesn't include `v1`. We don't block — the typed client still works for the v1 surface.                                           |

## Testing

Bar: ≥80% coverage; `mage qc:prerelease` clean before claiming done.

### Backend unit tests

- `backend/resources/gatewayapi/*_test.go` — one suite per kind. Each tests
  `buildXDetails` against `*v1.Gateway` / `*v1.HTTPRoute` / etc. fixtures using
  the `sigs.k8s.io/gateway-api/pkg/client/clientset/versioned/fake` fake
  clientset. Cover: minimal object, fully-populated object, multiple listeners
  / multiple rules, all condition states (True / False / Unknown), missing
  optional fields, status with no addresses, rules with no backendRefs.
- `backend/resources/gatewayapi/conditions_test.go` — table-driven for
  `summarizeConditions`: empty slice, condition not present, condition with
  all three statuses, multiple conditions where only some are requested.
- `backend/resources/gatewayapi/refs_test.go` — typed→`ObjectRef` /
  `RefOrDisplay` adapters: cluster-ID propagation, cross-namespace, all three
  version-resolution branches (hardcoded default, catalog lookup, unresolved
  fallback emitting `DisplayRef`).
- `backend/refresh/snapshot/namespace_network_test.go` — extended with one
  parallel sub-test per new kind asserting the row appears in
  `Snapshot.Resources` with correct `Kind`, `Details`, and `ClusterMeta`. Add
  nil-lister cases (CRD absent → no rows for that Kind).
- `backend/refresh/snapshot/cluster_config_test.go` — `GatewayClass` row added
  to existing tests; `BuildClusterGatewayClassSummary` table-driven.
- `backend/refresh/snapshot/permission_checks_test.go` — verifies the eight new
  permission specs flow through.
- `backend/refresh/snapshot/object_details_test.go` — for each kind, verify
  the dispatch table routes correctly and the typed builder is invoked.
- `backend/refresh/informer/factory_test.go` — verify `Start` and
  `WaitForCacheSync` correctly handle nil `gatewayFactory`; verify the
  dual-factory path syncs both.
- `backend/objectcatalog/informer_registry_test.go` — extended with the eight
  conditional registrations; verify nil-presence skips them.
- `backend/cluster_clients_test.go` — two new sub-tests:
  `presence.AnyPresent()=false` skips Gateway client construction;
  `AnyPresent()=true` constructs and starts the factory.
- `backend/resources_wrappers_test.go` — extend the wrapper-coverage matrix
  with the 16 new methods.
- `backend/response_cache_invalidation_test.go` — verify each of the eight
  kinds invalidates correctly on watch events; verify `Gateway` / `HTTPRoute`
  events invalidate the cached `GatewayClass` detail.

`backend/testsupport/gatewayapi.go` provides shared fixture helpers
(`NewGateway`, `NewHTTPRoute`, etc.) and fake listers, mirroring
`NewIngressLister` / `NewIngressClassLister`.

### Frontend unit tests (Vitest)

- `Details/GatewayDetailsTab.test.tsx` and the seven siblings — render with
  mock `*Details` payload covering: minimal data, full data with all
  conditions, conditions in each state, refs that resolve and refs that don't,
  empty listener / rule lists. Mock the data layer per `frontend/AGENTS.md` —
  never the rendering.
- `shared/components/StatusPill.test.tsx` — table-driven for the four states
  - missing condition; theme tokens render in both Light and Dark.
- `shared/components/ObjectPanelLink.test.tsx` — extended with the new
  `ObjectRef` / `RefOrDisplay` overloads: click-to-open for `ObjectRef` and
  the `Ref` branch of `RefOrDisplay`; the `Display` branch renders as plain
  text with tooltip and is non-navigable; disabled-when-unresolvable;
  cross-namespace navigation; cross-cluster (`clusterId` match).
- `modules/namespace/components/NsViewNetwork.test.tsx` — extend with the
  seven new kinds in the filter dropdown; verify rows render through the
  existing column factories.
- `modules/cluster/components/ClusterResourcesManager.test.tsx` —
  `GatewayClass` added to the kinds-list assertion.
- `core/capabilities/permissionSpecs.test.ts` — assert the eight new entries.
- `utils/kindAliasMap.test.ts` and `utils/kindViewMap.test.ts` — assertions
  for the eight new aliases and the eight kind→view mappings.

### Storybook

One story per `*DetailsTab` mounting through real ObjectPanel chrome with a
mocked Wails binding return. Real components and real CSS only.

### Manual verification

Repository ships `test/gateway-api/helm/` exercising every in-scope kind.
Pre-release sweep:

1. Apply Gateway API CRDs v1.5.0 + Envoy Gateway v1.7.2 per the chart's
   README.
2. `helm install demo ./test/gateway-api/helm -n gateway-api-demo --create-namespace`.
3. In the app, open the demo cluster and verify on the Namespace Network tab:
   each new kind appears with sensible Details summary; opening each row
   renders its typed `*DetailsTab` with non-empty content; status pills
   reflect Envoy Gateway's actual `Programmed` / `Accepted` outcomes;
   clickable refs navigate correctly between Gateway↔HTTPRoute↔Service.
4. Verify Cluster Config tab shows the `GatewayClass`(es) Envoy Gateway
   installs.
5. Uninstall the CRDs (`kubectl delete -f .../standard-install.yaml`),
   reconnect the cluster, verify the kinds disappear from filters and
   capabilities show "not installed".

### Coverage gaps

- The CRD-version-drift warning is observability-only; no test for the warning
  logger.
- Live-CRD-install (without reconnect) is explicitly out of scope for v1; no
  test, since there is no behavior to test.

## Documented follow-ups (not v1)

- Per-listener and per-parent status drill-down tables on `Gateway` /
  `HTTPRoute` / `GRPCRoute` / `TLSRoute` (Section "headline conditions"
  decision).
- Live mid-session CRD install detection (replacing reconnect requirement).
- `TCPRoute` / `UDPRoute` if they reach v1 and the project decides to support
  the experimental channel.
