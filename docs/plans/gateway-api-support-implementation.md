# Gateway API Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class support for eight Kubernetes Gateway API v1 kinds
(`GatewayClass`, `Gateway`, `ListenerSet`, `HTTPRoute`, `GRPCRoute`, `TLSRoute`,
`BackendTLSPolicy`, `ReferenceGrant`) at parity with the existing `Ingress`
treatment — typed details, Network-tab integration, status pills, clickable
cross-refs.

**Architecture:** Discovery-gated registration of `sigs.k8s.io/gateway-api`
typed clientset alongside the existing `kubernetes.Interface` and
`dynamic.Interface`. Per-kind typed `*Details` builders behind the existing
`object-details` refresh domain. Namespaced kinds extend the existing
`namespace-network` snapshot domain; `GatewayClass` extends `cluster-config`.
No new refresh domain; no new top-level frontend module.

**Tech Stack:** Go 1.x (backend), Wails v2 (bridge), React 18 + TypeScript
(frontend), `sigs.k8s.io/gateway-api` v1.5.x, Vitest, `client-go` shared
informers.

**Spec:** [docs/plans/gateway-api-support-design.md](./gateway-api-support-design.md) — read this before starting.

---

## Conventions used throughout this plan

- **TDD:** Write failing test → run to verify failure → implement → run to
  verify pass → pause for review. The skeleton is repeated as steps; test
  code is inlined per task.
- **Commits:** **Per `AGENTS.md`, agents must NEVER run state-modifying git
  commands (commit, push, PR creation) without explicit user direction.**
  When a step below says "Pause for commit", the agent stops and reports
  task completion to the user; the user (or the supervising agent) decides
  whether to commit and runs the command themselves. Suggested commit
  messages are provided as user-facing guidance only — the agent does not
  execute them. Commit message style follows the existing repo log
  (e.g. `feat: add gateway-api typed client wiring`).
- **Coverage bar:** ≥80% per file (`AGENTS.md`). Use `go test -cover` /
  `vitest --coverage` while iterating; tasks fail review below 80%.
- **Pre-merge gate:** `mage qc:prerelease` clean (`AGENTS.md`).
- **Imports/aliases:** Follow surrounding files. Gateway-API types alias as
  `gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"`; clientset as
  `gatewayversioned "sigs.k8s.io/gateway-api/pkg/client/clientset/versioned"`;
  informers as `gatewayinformers "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions"`;
  listers as `gatewaylisters "sigs.k8s.io/gateway-api/pkg/client/listers/apis/v1"`.
  **Verify the lister path** with `ls $(go env GOMODCACHE)/sigs.k8s.io/gateway-api@*/pkg/client/listers/`
  before copying — gateway-api generates listers under `apis/v1`, not the
  hypothetical `gateway/v1`.
- **Multi-cluster rule:** Every typed payload that names a referenced object
  carries `ClusterID` (per `AGENTS.md` hard rule). The detail builders read it
  from `deps.ClusterID`.
- **Plan ordering rationale:** types → discovery/conditions/refs → per-kind
  handlers → cluster wiring → snapshot domain extensions → object-detail
  routing → app wrappers → frontend plumbing → frontend components →
  verification. Earlier tasks unblock later ones; each commits standalone and
  builds clean.

---

## File Structure

### New backend files

| Path | Responsibility |
| --- | --- |
| `backend/resources/gatewayapi/service.go` | `Service` struct + `NewService(deps)` |
| `backend/resources/gatewayapi/conditions.go` | `summarizeConditions(conds, names...)` |
| `backend/resources/gatewayapi/refs.go` | typed→`ObjectRef` / `RefOrDisplay` adapters + version-resolution rule |
| `backend/resources/gatewayapi/discover.go` | `Discover(ctx, crdLister) GatewayAPIPresence` |
| `backend/resources/gatewayapi/gateway.go` | `Service.Gateway`, `Service.Gateways`, `buildGatewayDetails` |
| `backend/resources/gatewayapi/httproute.go` | HTTPRoute equivalents |
| `backend/resources/gatewayapi/grpcroute.go` | GRPCRoute equivalents |
| `backend/resources/gatewayapi/tlsroute.go` | TLSRoute equivalents |
| `backend/resources/gatewayapi/gatewayclass.go` | GatewayClass (cluster-scoped) |
| `backend/resources/gatewayapi/listenerset.go` | ListenerSet equivalents |
| `backend/resources/gatewayapi/referencegrant.go` | ReferenceGrant equivalents |
| `backend/resources/gatewayapi/backendtlspolicy.go` | BackendTLSPolicy equivalents |
| `backend/resources/gatewayapi/*_test.go` | Sibling test for every file above |
| `backend/testsupport/gatewayapi.go` | `NewGateway`/`NewHTTPRoute`/etc. fixture helpers + fake listers |
| `backend/resources_gatewayapi.go` | App wrappers (`App.GetGatewayDetails`, etc.) |
| `backend/resources_gatewayapi_test.go` | Wrapper-coverage extension |

### Modified backend files

| Path | Change |
| --- | --- |
| `go.mod` / `go.sum` | Add `sigs.k8s.io/gateway-api` |
| `backend/resources/types/types.go` | Add shared `ObjectRef`, `DisplayRef`, `RefOrDisplay`, `ConditionState`, `ConditionsSummary`, plus the eight per-kind `*Details` types and supporting structs |
| `backend/types.go` | Re-export new types |
| `backend/resources/common/deps.go` | Add `GatewayClient`, `GatewayAPIPresence` fields |
| `backend/cluster_clients.go` | Add `gatewayClient`/`gatewayInformerFactory`/`gatewayAPIPresence`/`gatewayVersionResolver` fields; discovery via `DiscoverViaDiscovery` (Task 17) |
| `backend/cluster_clients_test.go` | Cover both presence branches |
| `backend/resources_workloads.go` | `resourceDependenciesForSelection` propagates Gateway fields to `Deps` (Task 17 Step 5) |
| `backend/cluster_dependencies.go` | Audit any partial-Deps shortcuts; ensure new fields flow through |
| `backend/refresh/informer/factory.go` | Hold optional `gatewayFactory` + `gatewayPresence`; `Start`/`WaitForCacheSync`/`Shutdown` cover both (Tasks 17a, 18) |
| `backend/refresh/informer/factory_test.go` | Cover dual-factory + shutdown paths |
| `backend/refresh/system/manager.go` | `Config` gains `GatewayClient`/`GatewayInformerFactory`/`GatewayAPIPresence`; constructor calls `WithGatewayFactory`/`WithGatewayAPIPresence` (Task 17a) |
| `backend/refresh/system/manager_test.go` | Cover Config wire-through |
| `backend/refresh/system/registrations.go` | `cluster-config` + `namespace-network` registration call sites pass the refresh informer wrapper + presence + listChecks (Task 22a) |
| `backend/refresh/system/registrations_test.go` | Cover new flag wiring |
| `backend/app_refresh_setup.go` | `cfg := system.Config{…}` literal populates the three new Gateway fields from `clients` (Task 17a Step 4) |
| `backend/objectcatalog/informer_registry.go` | Parallel `gatewayInformerListers` + `gatewayInformerListersClusterScoped` registries; `registerGatewayAPIListers` helper (Task 19) |
| `backend/objectcatalog/informer_registry_test.go` | Verify nil-presence skip + per-kind gating |
| `backend/objectcatalog/types.go` | `Dependencies` gains `GatewayInformerFactory` + `GatewayAPIPresence` (Task 19 Step 5a) |
| `backend/objectcatalog/collect.go` | `collectViaSharedInformer` (or its caller) merges in the parallel registry (Task 19 Step 5c) |
| `backend/objectcatalog/watch.go` | Reactive watch handlers per kind (Task 19 Step 6) |
| `backend/app_object_catalog.go` | `objectcatalog.Dependencies{…}` literal at line 163 populates new fields; cache-sync wait extended; eager writeback to `clusterClients.gatewayVersionResolver` (Task 19 Steps 5b / 6a / 8) |
| `backend/refresh/snapshot/permission_checks.go` | 8 new permission specs |
| `backend/refresh/snapshot/namespace_network.go` | 7 new `IncludeXxx` flags + listers + Build branches |
| `backend/refresh/snapshot/namespace_network_test.go` | One sub-test per new kind |
| `backend/refresh/snapshot/cluster_config.go` | `IncludeGatewayClasses` + GatewayClass lister + Build branch |
| `backend/refresh/snapshot/cluster_config_test.go` | GatewayClass row + nil-lister case |
| `backend/refresh/snapshot/streaming_helpers.go` | `BuildClusterGatewayClassSummary` |
| `backend/refresh/snapshot/object_details.go` | 8 dispatch entries |
| `backend/refresh/snapshot/object_details_test.go` | Verify each dispatch routes correctly |
| `backend/object_detail_provider.go` | 8 cache-key + provider entries |
| `backend/response_cache_invalidation.go` | 8 invalidation entries; `Gateway`/`HTTPRoute` events also invalidate `GatewayClass.UsedBy` |
| `backend/response_cache_invalidation_test.go` | Cover each |
| `backend/resources_wrappers_test.go` | Add 16 new wrapper rows |

### New frontend files

| Path | Responsibility |
| --- | --- |
| `frontend/src/shared/components/StatusPill.tsx` | Pill for `ConditionState` |
| `frontend/src/shared/components/StatusPill.css` | Theme tokens |
| `frontend/src/shared/components/StatusPill.test.tsx` | Coverage |
| `frontend/src/modules/object-panel/components/ObjectPanel/Details/GatewayDetailsTab.tsx` | Typed details tab |
| `… HTTPRouteDetailsTab.tsx` | … |
| `… GRPCRouteDetailsTab.tsx` | … |
| `… TLSRouteDetailsTab.tsx` | … |
| `… GatewayClassDetailsTab.tsx` | … |
| `… ListenerSetDetailsTab.tsx` | … |
| `… ReferenceGrantDetailsTab.tsx` | … |
| `… BackendTLSPolicyDetailsTab.tsx` | … |
| Sibling `*.test.tsx` per tab | Vitest coverage |
| Sibling `*.stories.tsx` per tab | Storybook |

### Modified frontend files

| Path | Change |
| --- | --- |
| `frontend/src/utils/kindAliasMap.ts` | 8 new aliases (+ reverse) |
| `frontend/src/utils/kindAliasMap.test.ts` | Asserts |
| `frontend/src/utils/kindViewMap.ts` | 7 namespaced → `network`; `GatewayClass` → `cluster-config` |
| `frontend/src/utils/kindViewMap.test.ts` | Asserts |
| `frontend/src/shared/constants/builtinGroupVersions.ts` | Register `gateway.networking.k8s.io/v1` for each kind |
| `frontend/src/core/capabilities/catalog.ts` | 8 capability entries |
| `frontend/src/core/capabilities/permissionSpecs.ts` | 8 permission specs |
| `frontend/src/core/capabilities/permissionSpecs.test.ts` | Asserts |
| `frontend/src/ui/command-palette/CommandPaletteCommands.tsx` | Kind-jump entries |
| `frontend/src/modules/cluster/contexts/ClusterResourcesContext.tsx` | `GatewayClass` permission + kinds list |
| `frontend/src/modules/cluster/components/ClusterResourcesManager.tsx` | Same |
| `frontend/src/modules/cluster/components/ClusterResourcesManager.test.tsx` | Kinds-list assert |
| `frontend/src/core/refresh/types.ts` | Extend `ObjectDetailsSnapshotPayload` discriminator with 8 new payload variants |
| `frontend/src/modules/object-panel/components/ObjectPanel/Details/detailsTabTypes.ts` | Register 8 new tab types |
| `frontend/src/shared/components/ObjectPanelLink.tsx` | Accept `ObjectRef` *or* `RefOrDisplay`; `Display` branch renders plain text |
| `frontend/src/shared/components/ObjectPanelLink.test.tsx` | Cover both overloads |
| `frontend/src/modules/namespace/components/NsViewNetwork.test.tsx` | Cover new kinds in filter |

---

## Tasks

### Task 1: Add `sigs.k8s.io/gateway-api` Go dependency

**Files:**
- Modify: `go.mod`
- Modify: `go.sum`

- [ ] **Step 1: Add the module.** Pick the **current latest stable v1.5.x
  patch release** from
  <https://github.com/kubernetes-sigs/gateway-api/releases> at the time of
  implementation; do **not** assume v1.5.0 is current — check first.

  ```sh
  go get sigs.k8s.io/gateway-api@v1.5.x   # replace with the actual patch
  go mod tidy
  ```

- [ ] **Step 2: Verify imports compile.** Add a temporary import probe in `main.go` (top-level imports block):

  ```go
  _ "sigs.k8s.io/gateway-api/apis/v1"
  _ "sigs.k8s.io/gateway-api/pkg/client/clientset/versioned"
  _ "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions"
  _ "sigs.k8s.io/gateway-api/pkg/client/listers/apis/v1"
  ```

  Run `go build ./...` — expect success.

- [ ] **Step 3: Remove the probe imports** from `main.go` (they re-enter genuinely in later tasks).

- [ ] **Step 4: Run `go vet ./...`** — expect clean.

- [ ] **Step 5: Pause for commit.** Per Conventions, the agent does NOT run the commit. Report task complete and suggest the user run:

  ```sh
  git add go.mod go.sum
  git commit -m "chore: add sigs.k8s.io/gateway-api dependency"
  ```

---

### Task 2: Shared types — `ObjectRef`, `DisplayRef`, `RefOrDisplay`, `ConditionState`, `ConditionsSummary`

**Files:**
- Modify: `backend/resources/types/types.go`
- Modify: `backend/types.go`
- Modify: `backend/resources/types/types_test.go` (create if absent)

- [ ] **Step 1: Write the failing test.** Add to `backend/resources/types/types_test.go`:

  ```go
  func TestRefOrDisplayJSON_RefBranch(t *testing.T) {
      r := RefOrDisplay{Ref: &ObjectRef{
          ClusterID: "c1", Group: "", Version: "v1", Kind: "Service",
          Namespace: "ns", Name: "svc",
      }}
      b, err := json.Marshal(r)
      require.NoError(t, err)
      require.JSONEq(t, `{"ref":{"clusterId":"c1","group":"","version":"v1","kind":"Service","namespace":"ns","name":"svc"}}`, string(b))
  }

  func TestRefOrDisplayJSON_DisplayBranch(t *testing.T) {
      r := RefOrDisplay{Display: &DisplayRef{
          ClusterID: "c1", Group: "example.com", Kind: "Widget",
          Namespace: "ns", Name: "w",
      }}
      b, err := json.Marshal(r)
      require.NoError(t, err)
      require.JSONEq(t, `{"display":{"clusterId":"c1","group":"example.com","kind":"Widget","namespace":"ns","name":"w"}}`, string(b))
  }

  func TestConditionsSummaryJSON_OmitEmpty(t *testing.T) {
      s := ConditionsSummary{Programmed: &ConditionState{Status: "True"}}
      b, err := json.Marshal(s)
      require.NoError(t, err)
      require.JSONEq(t, `{"programmed":{"status":"True"}}`, string(b))
  }
  ```

- [ ] **Step 2: Run** `go test ./backend/resources/types/...` — expect FAIL (types not defined).

- [ ] **Step 3: Implement.** Append to `backend/resources/types/types.go`:

  ```go
  // ObjectRef carries the cluster ID + GVK + namespace/name needed to open
  // any object in the panel. Version is always non-empty per the AGENTS.md
  // hard rule.
  type ObjectRef struct {
      ClusterID string `json:"clusterId"`
      Group     string `json:"group"`
      Version   string `json:"version"`
      Kind      string `json:"kind"`
      Namespace string `json:"namespace,omitempty"`
      Name      string `json:"name"`
  }

  // DisplayRef is used for refs whose API version cannot be proven on the
  // current cluster. It is *not* navigable; the frontend renders it as
  // plain text.
  type DisplayRef struct {
      ClusterID string `json:"clusterId"`
      Group     string `json:"group"`
      Kind      string `json:"kind"`
      Namespace string `json:"namespace,omitempty"`
      Name      string `json:"name"`
  }

  // RefOrDisplay carries either a navigable Ref or a plain-text Display ref.
  // Exactly one branch is populated.
  type RefOrDisplay struct {
      Ref     *ObjectRef  `json:"ref,omitempty"`
      Display *DisplayRef `json:"display,omitempty"`
  }

  // ConditionState mirrors metav1.Condition with only the fields the UI shows.
  type ConditionState struct {
      Status  string `json:"status"`
      Reason  string `json:"reason,omitempty"`
      Message string `json:"message,omitempty"`
  }

  // ConditionsSummary collects the named conditions per kind into a flat
  // shape so the UI can render them without iterating arbitrary slices.
  // GatewayClass.status.supportedFeatures is *not* a metav1.Condition; it
  // is a separate status slice and is surfaced via
  // GatewayClassDetails.SupportedFeatures (Task 3).
  type ConditionsSummary struct {
      Programmed   *ConditionState `json:"programmed,omitempty"`
      Accepted     *ConditionState `json:"accepted,omitempty"`
      ResolvedRefs *ConditionState `json:"resolvedRefs,omitempty"`
  }
  ```

- [ ] **Step 4: Re-export.** Append to the type aliases block in `backend/types.go`:

  ```go
  ObjectRef         = types.ObjectRef
  DisplayRef        = types.DisplayRef
  RefOrDisplay      = types.RefOrDisplay
  ConditionState    = types.ConditionState
  ConditionsSummary = types.ConditionsSummary
  ```

- [ ] **Step 5: Run** `go test ./backend/resources/types/...` — expect PASS.

- [ ] **Step 6: Pause for commit.** Per Conventions, the agent does NOT run the commit. Report task complete and suggest the user run:

  ```sh
  git add backend/resources/types/types.go backend/resources/types/types_test.go backend/types.go
  git commit -m "feat: add shared ObjectRef/DisplayRef/RefOrDisplay/ConditionsSummary types"
  ```

---

### Task 3: Per-kind detail types

**Files:**
- Modify: `backend/resources/types/types.go`
- Modify: `backend/types.go`
- Modify: `backend/resources/types/types_test.go`

- [ ] **Step 1: Write failing tests.** Add a JSON round-trip test for each new struct verifying field tags and `omitempty` behavior. Single example for `GatewayDetails`:

  ```go
  func TestGatewayDetailsJSON(t *testing.T) {
      d := GatewayDetails{
          Kind: "Gateway", Name: "demo", Namespace: "ns",
          GatewayClassRef: ObjectRef{ClusterID: "c1", Group: "gateway.networking.k8s.io", Version: "v1", Kind: "GatewayClass", Name: "envoy"},
          Listeners:            []GatewayListener{{Name: "http", Port: 80, Protocol: "HTTP"}},
          Addresses:            []GatewayAddress{{Type: "IPAddress", Value: "10.0.0.1"}},
          ConditionsSummary:    ConditionsSummary{Programmed: &ConditionState{Status: "True"}},
          ListenerStatusCounts: "1/1 programmed",
      }
      _, err := json.Marshal(d)
      require.NoError(t, err)
  }
  ```

  Repeat for `HTTPRouteDetails`, `GRPCRouteDetails`, `TLSRouteDetails`,
  `GatewayClassDetails`, `ListenerSetDetails`, `ReferenceGrantDetails`,
  `BackendTLSPolicyDetails` and the supporting `GatewayListener`,
  `GatewayAddress`, `RouteRule`, `BackendRef`, `RouteParentStatus`,
  `ReferenceGrantFrom`, `ReferenceGrantTo`, `BackendTLSValidation`,
  `PolicyAncestorStatus` — each with at least one fully-populated round-trip
  assertion.

- [ ] **Step 2: Run** `go test ./backend/resources/types/...` — expect FAIL.

- [ ] **Step 3: Implement.** Append to `backend/resources/types/types.go`. Field shape:

  ```go
  // Common envelope: every *Details below carries
  //   Kind, Name, Namespace, Age string
  //   Labels, Annotations map[string]string
  //   Details string (the human-readable summary used by the Network tab)
  // listed once via embedding for brevity.

  type DetailsEnvelope struct {
      Kind        string            `json:"kind"`
      Name        string            `json:"name"`
      Namespace   string            `json:"namespace,omitempty"`
      Age         string            `json:"age,omitempty"`
      Labels      map[string]string `json:"labels,omitempty"`
      Annotations map[string]string `json:"annotations,omitempty"`
      Details     string            `json:"details,omitempty"`
  }

  type GatewayListener struct {
      Name                   string            `json:"name"`
      Port                   int32             `json:"port"`
      Protocol               string            `json:"protocol"`
      Hostname               string            `json:"hostname,omitempty"`
      TLSMode                string            `json:"tlsMode,omitempty"`
      AllowedRoutesSummary   string            `json:"allowedRoutesSummary,omitempty"`
      ConditionsSummary      ConditionsSummary `json:"conditionsSummary"`
  }

  type GatewayAddress struct {
      Type  string `json:"type"`
      Value string `json:"value"`
  }

  type GatewayDetails struct {
      DetailsEnvelope
      GatewayClassRef      ObjectRef         `json:"gatewayClassRef"`
      Listeners            []GatewayListener `json:"listeners,omitempty"`
      Addresses            []GatewayAddress  `json:"addresses,omitempty"`
      ConditionsSummary    ConditionsSummary `json:"conditionsSummary"`
      ListenerStatusCounts string            `json:"listenerStatusCounts,omitempty"`
  }

  type BackendRef struct {
      Ref    RefOrDisplay `json:"ref"`
      Weight int32        `json:"weight,omitempty"`
      Port   int32        `json:"port,omitempty"`
  }

  type RouteRule struct {
      MatchSummary string       `json:"matchSummary,omitempty"`
      BackendRefs  []BackendRef `json:"backendRefs,omitempty"`
  }

  type RouteParentStatus struct {
      Parent     RefOrDisplay      `json:"parent"`
      Conditions ConditionsSummary `json:"conditions"`
  }

  type HTTPRouteDetails struct {
      DetailsEnvelope
      Hostnames      []string            `json:"hostnames,omitempty"`
      ParentRefs     []RefOrDisplay      `json:"parentRefs,omitempty"`
      Rules          []RouteRule         `json:"rules,omitempty"`
      ParentStatuses []RouteParentStatus `json:"parentStatuses,omitempty"`
  }

  // GRPCRouteDetails has the same shape as HTTPRouteDetails.
  type GRPCRouteDetails HTTPRouteDetails
  // TLSRouteDetails likewise.
  type TLSRouteDetails HTTPRouteDetails

  type GatewayClassDetails struct {
      DetailsEnvelope
      ControllerName    string            `json:"controllerName"`
      Description       string            `json:"description,omitempty"`
      ConditionsSummary ConditionsSummary `json:"conditionsSummary"` // Accepted only
      // SupportedFeatures is sourced from status.supportedFeatures
      // ([]gatewayv1.SupportedFeature, each with a Name field). Rendered as
      // a chip list in the UI, not a status pill.
      SupportedFeatures []string    `json:"supportedFeatures,omitempty"`
      UsedBy            []ObjectRef `json:"usedBy,omitempty"`
  }

  type ListenerSetDetails struct {
      DetailsEnvelope
      ParentRef         ObjectRef         `json:"parentRef"`
      Listeners         []GatewayListener `json:"listeners,omitempty"`
      ConditionsSummary ConditionsSummary `json:"conditionsSummary"`
  }

  type ReferenceGrantFrom struct {
      Group     string `json:"group"`
      Kind      string `json:"kind"`
      Namespace string `json:"namespace"`
  }

  type ReferenceGrantTo struct {
      Group  string        `json:"group"`
      Kind   string        `json:"kind"`
      Target *RefOrDisplay `json:"target,omitempty"`
  }

  type ReferenceGrantDetails struct {
      DetailsEnvelope
      From []ReferenceGrantFrom `json:"from,omitempty"`
      To   []ReferenceGrantTo   `json:"to,omitempty"`
  }

  type BackendTLSValidation struct {
      CACertificateRefs []ObjectRef `json:"caCertificateRefs,omitempty"`
      Hostname          string      `json:"hostname,omitempty"`
      WellKnownCACerts  string      `json:"wellKnownCACerts,omitempty"`
  }

  type PolicyAncestorStatus struct {
      Ancestor       RefOrDisplay      `json:"ancestor"`
      ControllerName string            `json:"controllerName,omitempty"`
      Conditions     ConditionsSummary `json:"conditions"`
  }

  type BackendTLSPolicyDetails struct {
      DetailsEnvelope
      TargetRefs       []RefOrDisplay         `json:"targetRefs,omitempty"`
      Validation       BackendTLSValidation   `json:"validation"`
      AncestorStatuses []PolicyAncestorStatus `json:"ancestorStatuses,omitempty"`
  }
  ```

- [ ] **Step 4: Re-export.** Add to `backend/types.go` aliases block (one line per type, mirroring existing pattern).

- [ ] **Step 5: Run** `go test ./backend/resources/types/...` — expect PASS.

- [ ] **Step 6: Pause for commit.** Per Conventions, the agent does NOT run the commit. Suggested user-run message: `feat: add Gateway API typed details payload structs`

---

### Task 4: `gatewayapi.Discover` + `GatewayAPIPresence`

**Files:**
- Create: `backend/resources/gatewayapi/discover.go`
- Create: `backend/resources/gatewayapi/discover_test.go`

- [ ] **Step 1: Write the failing test.**

  ```go
  // discover_test.go
  package gatewayapi

  import (
      "context"
      "testing"

      apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
      metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
      "k8s.io/client-go/tools/cache"
      apiextlisters "k8s.io/apiextensions-apiserver/pkg/client/listers/apiextensions/v1"
      "github.com/stretchr/testify/require"
  )

  func newCRDLister(t *testing.T, crds ...*apiextensionsv1.CustomResourceDefinition) apiextlisters.CustomResourceDefinitionLister {
      indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{})
      for _, crd := range crds {
          require.NoError(t, indexer.Add(crd))
      }
      return apiextlisters.NewCustomResourceDefinitionLister(indexer)
  }

  func crd(name, group string, kinds []string) *apiextensionsv1.CustomResourceDefinition {
      return &apiextensionsv1.CustomResourceDefinition{
          ObjectMeta: metav1.ObjectMeta{Name: name},
          Spec: apiextensionsv1.CustomResourceDefinitionSpec{
              Group: group,
              Names: apiextensionsv1.CustomResourceDefinitionNames{Kind: kinds[0]},
              Versions: []apiextensionsv1.CustomResourceDefinitionVersion{{Name: "v1", Served: true, Storage: true}},
          },
      }
  }

  func TestDiscover_None(t *testing.T) {
      lister := newCRDLister(t)
      p, err := Discover(context.Background(), lister)
      require.NoError(t, err)
      require.False(t, p.AnyPresent())
  }

  func TestDiscover_GatewayOnly(t *testing.T) {
      lister := newCRDLister(t,
          crd("gateways.gateway.networking.k8s.io", "gateway.networking.k8s.io", []string{"Gateway"}),
      )
      p, err := Discover(context.Background(), lister)
      require.NoError(t, err)
      require.True(t, p.Gateway)
      require.False(t, p.HTTPRoute)
      require.True(t, p.AnyPresent())
  }

  func TestDiscover_All(t *testing.T) {
      // …add one CRD per in-scope kind, assert all eight presence flags are true.
  }

  func TestDiscover_OnlyV1Counts(t *testing.T) {
      // CRD whose only served version is v1alpha2 — assert presence is false.
  }
  ```

- [ ] **Step 2: Run** `go test ./backend/resources/gatewayapi/...` — expect FAIL (`Discover` not defined).

- [ ] **Step 3: Implement.** Create `backend/resources/gatewayapi/discover.go`:

  ```go
  package gatewayapi

  import (
      "context"

      apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
      apiextlisters "k8s.io/apiextensions-apiserver/pkg/client/listers/apiextensions/v1"
      "k8s.io/apimachinery/pkg/labels"
  )

  const gatewayAPIGroup = "gateway.networking.k8s.io"

  // GatewayAPIPresence reports which of the in-scope kinds have a v1 CRD served on the cluster.
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

  func (p GatewayAPIPresence) AnyPresent() bool {
      return p.Gateway || p.GatewayClass || p.HTTPRoute || p.GRPCRoute ||
          p.TLSRoute || p.ListenerSet || p.ReferenceGrant || p.BackendTLSPolicy
  }

  // Discover reads the supplied CRD lister and returns the per-kind presence
  // flags. A kind is present when its CRD exists in the gateway.networking.k8s.io
  // group AND at least one served version is "v1".
  func Discover(ctx context.Context, crdLister apiextlisters.CustomResourceDefinitionLister) (GatewayAPIPresence, error) {
      crds, err := crdLister.List(labels.Everything())
      if err != nil {
          return GatewayAPIPresence{}, err
      }
      var p GatewayAPIPresence
      for _, c := range crds {
          if c == nil || c.Spec.Group != gatewayAPIGroup {
              continue
          }
          if !servesV1(c) {
              continue
          }
          switch c.Spec.Names.Kind {
          case "Gateway":
              p.Gateway = true
          case "GatewayClass":
              p.GatewayClass = true
          case "HTTPRoute":
              p.HTTPRoute = true
          case "GRPCRoute":
              p.GRPCRoute = true
          case "TLSRoute":
              p.TLSRoute = true
          case "ListenerSet":
              p.ListenerSet = true
          case "ReferenceGrant":
              p.ReferenceGrant = true
          case "BackendTLSPolicy":
              p.BackendTLSPolicy = true
          }
      }
      return p, nil
  }

  func servesV1(c *apiextensionsv1.CustomResourceDefinition) bool {
      for _, v := range c.Spec.Versions {
          if v.Name == "v1" && v.Served {
              return true
          }
      }
      return false
  }
  ```

- [ ] **Step 4: Run** tests — expect PASS.

- [ ] **Step 5: Pause for commit.** Per Conventions, the agent does NOT run the commit. Report task complete. Suggested user-run message: `feat(gatewayapi): add CRD presence discovery`

---

### Task 5: `summarizeConditions` helper

**Files:**
- Create: `backend/resources/gatewayapi/conditions.go`
- Create: `backend/resources/gatewayapi/conditions_test.go`

- [ ] **Step 1: Write failing tests.** Cover: empty slice → empty summary; condition not in `names` ignored; True/False/Unknown statuses preserved; same-named condition only the first is taken (defensive); message and reason propagate.

  ```go
  func TestSummarizeConditions_Empty(t *testing.T) {
      s := summarizeConditions(nil, "Programmed", "Accepted")
      require.Empty(t, s)
  }

  func TestSummarizeConditions_Selects(t *testing.T) {
      conds := []metav1.Condition{
          {Type: "Programmed", Status: metav1.ConditionTrue, Reason: "Ready"},
          {Type: "Accepted", Status: metav1.ConditionFalse, Reason: "Pending", Message: "waiting"},
          {Type: "Other", Status: metav1.ConditionTrue}, // ignored
      }
      s := summarizeConditions(conds, "Programmed", "Accepted")
      require.NotNil(t, s.Programmed)
      require.Equal(t, "True", s.Programmed.Status)
      require.NotNil(t, s.Accepted)
      require.Equal(t, "waiting", s.Accepted.Message)
  }

  func TestSummarizeConditions_UnknownAndMissing(t *testing.T) {
      // Unknown status preserved; ResolvedRefs missing => nil pointer.
  }
  ```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement.**

  ```go
  package gatewayapi

  import (
      metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

      "github.com/luxury-yacht/app/backend/resources/types"
  )

  // summarizeConditions extracts the named conditions from a metav1.Condition
  // slice into a flat ConditionsSummary. Names should be the canonical
  // condition Type strings ("Programmed", "Accepted", "ResolvedRefs");
  // unknown names are accepted but not surfaced structurally.
  func summarizeConditions(conds []metav1.Condition, names ...string) types.ConditionsSummary {
      var out types.ConditionsSummary
      for _, name := range names {
          c := findCondition(conds, name)
          if c == nil {
              continue
          }
          state := &types.ConditionState{
              Status:  string(c.Status),
              Reason:  c.Reason,
              Message: c.Message,
          }
          switch name {
          case "Programmed":
              out.Programmed = state
          case "Accepted":
              out.Accepted = state
          case "ResolvedRefs":
              out.ResolvedRefs = state
          }
      }
      return out
  }

  func findCondition(conds []metav1.Condition, name string) *metav1.Condition {
      for i := range conds {
          if conds[i].Type == name {
              return &conds[i]
          }
      }
      return nil
  }
  ```

- [ ] **Step 4: Run** — expect PASS.

- [ ] **Step 5: Pause for commit.** Per Conventions, the agent does NOT run the commit. Report task complete. Suggested user-run message: `feat(gatewayapi): summarizeConditions helper`

---

### Task 6: `refs.go` adapters with version resolution

**Files:**
- Create: `backend/resources/gatewayapi/refs.go`
- Create: `backend/resources/gatewayapi/refs_test.go`

- [ ] **Step 1: Define the catalog interface.** Use a narrow interface so tests can fake it:

  ```go
  // VersionResolver returns the preferred served version for a GVK, or "" if
  // the GVK is unknown or ambiguous on this cluster.
  type VersionResolver interface {
      PreferredVersion(group, kind string) string
  }
  ```

  This is consumed by `refs.go`. Real implementation comes from the existing
  object catalog in a later task (Task 19); for now wire through the
  interface.

- [ ] **Step 2: Write failing tests** covering all three resolution branches:

  ```go
  type fakeResolver map[string]string // key "group/Kind" -> version
  func (f fakeResolver) PreferredVersion(g, k string) string { return f[g+"/"+k] }

  func TestParentRefToRefOrDisplay_HardcodedDefault(t *testing.T) {
      // empty group + Service => v1
      pr := gatewayv1.ParentReference{
          Group: ptr(""), Kind: ptrKind("Service"),
          Name: "demo", Namespace: ptrNs("ns"),
      }
      r := ParentRefToRefOrDisplay("c1", "default-ns", pr, nil)
      require.NotNil(t, r.Ref)
      require.Equal(t, "v1", r.Ref.Version)
      require.Equal(t, "Service", r.Ref.Kind)
      require.Equal(t, "ns", r.Ref.Namespace)
  }

  func TestParentRefToRefOrDisplay_GatewayDefault(t *testing.T) {
      pr := gatewayv1.ParentReference{
          Group: ptrGroup("gateway.networking.k8s.io"), Kind: ptrKind("Gateway"),
          Name: "demo",
      }
      r := ParentRefToRefOrDisplay("c1", "ns", pr, nil)
      require.NotNil(t, r.Ref)
      require.Equal(t, "v1", r.Ref.Version)
      require.Equal(t, "ns", r.Ref.Namespace) // falls back to grant ns
  }

  func TestParentRefToRefOrDisplay_CatalogResolves(t *testing.T) {
      pr := gatewayv1.ParentReference{
          Group: ptrGroup("custom.example.com"), Kind: ptrKind("Widget"),
          Name: "w",
      }
      resolver := fakeResolver{"custom.example.com/Widget": "v2"}
      r := ParentRefToRefOrDisplay("c1", "ns", pr, resolver)
      require.NotNil(t, r.Ref)
      require.Equal(t, "v2", r.Ref.Version)
  }

  func TestParentRefToRefOrDisplay_UnresolvedFallback(t *testing.T) {
      pr := gatewayv1.ParentReference{
          Group: ptrGroup("custom.example.com"), Kind: ptrKind("Widget"),
          Name: "w",
      }
      r := ParentRefToRefOrDisplay("c1", "ns", pr, fakeResolver{})
      require.Nil(t, r.Ref)
      require.NotNil(t, r.Display)
      require.Equal(t, "custom.example.com", r.Display.Group)
      require.Equal(t, "Widget", r.Display.Kind)
  }
  ```

  Add equivalent table-driven tests for `BackendRefToRefOrDisplay` and
  `LocalObjectRefToRefOrDisplay` (the local-ref variant defaults the
  namespace from a parameter — used by `BackendTLSPolicy.targetRefs` etc.).

- [ ] **Step 3: Run** — expect FAIL.

- [ ] **Step 4: Implement** `backend/resources/gatewayapi/refs.go`:

  ```go
  package gatewayapi

  import (
      gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"

      "github.com/luxury-yacht/app/backend/resources/types"
  )

  // VersionResolver is implemented by the object catalog.
  type VersionResolver interface {
      PreferredVersion(group, kind string) string
  }

  // resolveVersion runs the three-step rule. Empty result means "fall through
  // to DisplayRef".
  func resolveVersion(group, kind string, r VersionResolver) string {
      // Step 1: hardcoded defaults.
      switch {
      case group == "" && (kind == "Service" || kind == "ConfigMap" || kind == "Secret"):
          return "v1"
      case group == gatewayAPIGroup:
          switch kind {
          case "Gateway", "GatewayClass", "HTTPRoute", "GRPCRoute",
              "TLSRoute", "ListenerSet", "ReferenceGrant", "BackendTLSPolicy":
              return "v1"
          }
      }
      // Step 2: catalog lookup.
      if r != nil {
          if v := r.PreferredVersion(group, kind); v != "" {
              return v
          }
      }
      // Step 3: caller emits DisplayRef.
      return ""
  }

  // ParentRefToRefOrDisplay converts a Gateway-API ParentReference into a
  // typed payload. defaultNamespace is the parent object's own namespace
  // (used when the ref omits namespace, per spec).
  func ParentRefToRefOrDisplay(clusterID, defaultNamespace string, pr gatewayv1.ParentReference, r VersionResolver) types.RefOrDisplay {
      group := strOrDefault(pr.Group, gatewayAPIGroup)
      kind := strOrDefault(pr.Kind, "Gateway")
      ns := strOrDefault(pr.Namespace, defaultNamespace)
      name := string(pr.Name)
      return refOrDisplay(clusterID, group, kind, ns, name, r)
  }

  // BackendRefToRefOrDisplay converts a Gateway-API BackendObjectReference.
  // Service is the implicit kind when group is empty and kind is unset.
  func BackendRefToRefOrDisplay(clusterID, defaultNamespace string, br gatewayv1.BackendObjectReference, r VersionResolver) types.RefOrDisplay {
      group := strOrDefault(br.Group, "")
      kind := strOrDefault(br.Kind, "Service")
      ns := strOrDefault(br.Namespace, defaultNamespace)
      name := string(br.Name)
      return refOrDisplay(clusterID, group, kind, ns, name, r)
  }

  // LocalObjectRefToRefOrDisplay covers BackendTLSPolicy.spec.targetRefs and
  // similar local-only refs that always live in the policy's namespace.
  func LocalObjectRefToRefOrDisplay(clusterID, namespace string, group, kind, name string, r VersionResolver) types.RefOrDisplay {
      return refOrDisplay(clusterID, group, kind, namespace, name, r)
  }

  func refOrDisplay(clusterID, group, kind, ns, name string, r VersionResolver) types.RefOrDisplay {
      version := resolveVersion(group, kind, r)
      if version == "" {
          return types.RefOrDisplay{Display: &types.DisplayRef{
              ClusterID: clusterID, Group: group, Kind: kind, Namespace: ns, Name: name,
          }}
      }
      return types.RefOrDisplay{Ref: &types.ObjectRef{
          ClusterID: clusterID, Group: group, Version: version, Kind: kind,
          Namespace: ns, Name: name,
      }}
  }

  // strOrDefault unwraps a *string-like (gateway-api typedefs are *Group, *Kind, etc.)
  // to a plain string with a fallback.
  func strOrDefault[T ~string](p *T, fallback string) string {
      if p == nil || string(*p) == "" {
          return fallback
      }
      return string(*p)
  }
  ```

- [ ] **Step 5: Run** tests — expect PASS.

- [ ] **Step 6: Pause for commit.** Per Conventions, the agent does NOT run the commit. Report task complete. Suggested user-run message: `feat(gatewayapi): typed→ObjectRef/RefOrDisplay adapters`

---

### Task 7: `Service` skeleton + `Deps` extension

**Files:**
- Modify: `backend/resources/common/deps.go`
- Create: `backend/resources/gatewayapi/service.go`
- Create: `backend/resources/gatewayapi/service_test.go`
- Create: `backend/resources/gatewayapi/errors.go`

- [ ] **Step 1: Extend `Dependencies`.** Add fields to `backend/resources/common/deps.go`:

  ```go
  // GatewayClient is non-nil when at least one Gateway-API CRD is present.
  GatewayClient        gatewayversioned.Interface
  GatewayAPIPresence   GatewayAPIPresence
  GatewayVersionResolver VersionResolver
  ```

  Avoid an import cycle: import `gatewayversioned` at the top of `deps.go`,
  but `GatewayAPIPresence` and `VersionResolver` come from the gatewayapi
  package, which would be a cycle (`common` → `gatewayapi` → `common`).
  Resolve by defining minimal interfaces in `common`:

  ```go
  // GatewayAPIPresence is implemented by gatewayapi.GatewayAPIPresence.
  type GatewayAPIPresence interface {
      AnyPresent() bool
      Has(kind string) bool // Gateway, HTTPRoute, etc.
  }
  ```

  Then in `gatewayapi/discover.go` add the `Has` method:

  ```go
  func (p GatewayAPIPresence) Has(kind string) bool {
      switch kind {
      case "Gateway":          return p.Gateway
      case "GatewayClass":     return p.GatewayClass
      case "HTTPRoute":        return p.HTTPRoute
      case "GRPCRoute":        return p.GRPCRoute
      case "TLSRoute":         return p.TLSRoute
      case "ListenerSet":      return p.ListenerSet
      case "ReferenceGrant":   return p.ReferenceGrant
      case "BackendTLSPolicy": return p.BackendTLSPolicy
      }
      return false
  }
  ```

  And update `discover_test.go` to cover `Has` for one truthy and one falsy
  kind.

  Likewise: define `common.VersionResolver` with the same `PreferredVersion`
  shape, and have `gatewayapi.VersionResolver` reference it. (Move the
  interface into `common`, drop the duplicate in `refs.go`.)

- [ ] **Step 2: Define `ErrGatewayAPINotInstalled`.** Create `backend/resources/gatewayapi/errors.go`:

  ```go
  package gatewayapi

  import "errors"

  var ErrGatewayAPINotInstalled = errors.New("gateway-api: kind not installed on this cluster")
  ```

- [ ] **Step 3: Write the failing test.** `service_test.go`:

  ```go
  func TestNewService_NilClient(t *testing.T) {
      s := NewService(common.Dependencies{})
      require.NotNil(t, s)
      _, err := s.Gateway("ns", "name")
      require.ErrorIs(t, err, ErrGatewayAPINotInstalled)
  }
  ```

  This will fail to compile until `Service.Gateway` exists. (Method itself
  comes in Task 8.) For now stub:

  ```go
  // service.go
  package gatewayapi

  import "github.com/luxury-yacht/app/backend/resources/common"

  type Service struct{ deps common.Dependencies }

  func NewService(deps common.Dependencies) *Service { return &Service{deps: deps} }
  ```

  Test compiles only after Task 8 lands; mark it skipped for now:

  ```go
  func TestNewService_NilClient(t *testing.T) {
      t.Skip("activated once handlers exist (Task 8)")
  }
  ```

  (We unskip in Task 8.)

- [ ] **Step 4: Run** `go build ./...` and `go test ./backend/resources/gatewayapi/...` — expect PASS / SKIP.

- [ ] **Step 5: Pause for commit.** Per Conventions, the agent does NOT run the commit. Report task complete. Suggested user-run message: `feat(gatewayapi): Service skeleton + Deps extension`

---

### Task 8: Gateway handler + `buildGatewayDetails`

**Files:**
- Create: `backend/resources/gatewayapi/gateway.go`
- Create: `backend/resources/gatewayapi/gateway_test.go`
- Modify: `backend/resources/gatewayapi/service_test.go` (unskip)

- [ ] **Step 1: Write failing tests.**

  ```go
  // gateway_test.go
  func TestService_Gateway_NotInstalled(t *testing.T) {
      s := NewService(common.Dependencies{})
      _, err := s.Gateway("ns", "demo")
      require.ErrorIs(t, err, ErrGatewayAPINotInstalled)
  }

  func TestService_Gateway_PartialPresenceMissingKind(t *testing.T) {
      // Client present, but Gateway kind is NOT installed (e.g. only HTTPRoute exists).
      client := gatewayfake.NewSimpleClientset()
      s := NewService(common.Dependencies{
          GatewayClient:      client,
          GatewayAPIPresence: GatewayAPIPresence{HTTPRoute: true},
          ClusterID:          "c1",
      })
      _, err := s.Gateway("ns", "demo")
      require.ErrorIs(t, err, ErrGatewayAPINotInstalled)
  }

  func TestBuildGatewayDetails_FullStatus(t *testing.T) {
      gw := testsupport.NewGateway("demo", "ns",
          testsupport.WithListener("http", 80, "HTTP"),
          testsupport.WithGatewayCondition("Programmed", metav1.ConditionTrue, "Ready", ""),
          testsupport.WithGatewayCondition("Accepted", metav1.ConditionTrue, "Accepted", ""),
          testsupport.WithGatewayAddress("IPAddress", "10.0.0.1"),
          testsupport.WithGatewayClassName("envoy"),
      )
      d := buildGatewayDetails("c1", gw, nil)
      require.Equal(t, "Gateway", d.Kind)
      require.Equal(t, "envoy", d.GatewayClassRef.Name)
      require.Equal(t, "v1", d.GatewayClassRef.Version)
      require.Len(t, d.Listeners, 1)
      require.Equal(t, "True", d.ConditionsSummary.Programmed.Status)
      require.Contains(t, d.Details, "10.0.0.1")
  }
  ```

  Plus tests for: empty status (Listeners count is 0/0); multiple listeners
  with mixed Programmed True/False (`ListenerStatusCounts` reads "1/2
  programmed"); listener TLS terminate vs passthrough; `AllowedRoutes` with
  namespace selector → summary string.

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement** `gateway.go`:

  ```go
  package gatewayapi

  import (
      "context"
      "fmt"
      "strings"

      metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
      gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"

      "github.com/luxury-yacht/app/backend/resources/common"
      "github.com/luxury-yacht/app/backend/resources/types"
  )

  func (s *Service) Gateway(namespace, name string) (*types.GatewayDetails, error) {
      if err := s.ensureKind("Gateway"); err != nil {
          return nil, err
      }
      ctx := s.deps.Context
      gw, err := s.deps.GatewayClient.GatewayV1().Gateways(namespace).Get(ctx, name, metav1.GetOptions{})
      if err != nil {
          return nil, err
      }
      return buildGatewayDetails(s.deps.ClusterID, gw, s.deps.GatewayVersionResolver), nil
  }

  func (s *Service) Gateways(namespace string) ([]*types.GatewayDetails, error) {
      if err := s.ensureKind("Gateway"); err != nil {
          return nil, err
      }
      ctx := s.deps.Context
      list, err := s.deps.GatewayClient.GatewayV1().Gateways(namespace).List(ctx, metav1.ListOptions{})
      if err != nil {
          return nil, err
      }
      out := make([]*types.GatewayDetails, 0, len(list.Items))
      for i := range list.Items {
          out = append(out, buildGatewayDetails(s.deps.ClusterID, &list.Items[i], s.deps.GatewayVersionResolver))
      }
      return out, nil
  }

  // ensureKind returns ErrGatewayAPINotInstalled when the client is nil or
  // the kind's per-kind presence flag is false.
  func (s *Service) ensureKind(kind string) error {
      if s.deps.GatewayClient == nil {
          return ErrGatewayAPINotInstalled
      }
      if s.deps.GatewayAPIPresence == nil || !s.deps.GatewayAPIPresence.Has(kind) {
          return ErrGatewayAPINotInstalled
      }
      return nil
  }

  func buildGatewayDetails(clusterID string, gw *gatewayv1.Gateway, r common.VersionResolver) *types.GatewayDetails {
      d := &types.GatewayDetails{
          DetailsEnvelope: types.DetailsEnvelope{
              Kind:        "Gateway",
              Name:        gw.Name,
              Namespace:   gw.Namespace,
              Age:         common.FormatAge(gw.CreationTimestamp.Time),
              Labels:      gw.Labels,
              Annotations: gw.Annotations,
          },
          GatewayClassRef: types.ObjectRef{
              ClusterID: clusterID,
              Group:     gatewayAPIGroup,
              Version:   "v1",
              Kind:      "GatewayClass",
              Name:      string(gw.Spec.GatewayClassName),
          },
          ConditionsSummary: summarizeConditions(gw.Status.Conditions, "Programmed", "Accepted"),
      }
      for _, l := range gw.Spec.Listeners {
          d.Listeners = append(d.Listeners, buildGatewayListener(l, gw.Status.Listeners))
      }
      for _, a := range gw.Status.Addresses {
          if a.Value == "" { continue }
          d.Addresses = append(d.Addresses, types.GatewayAddress{Type: stringFromPtr(a.Type), Value: a.Value})
      }
      d.ListenerStatusCounts = listenerStatusCounts(gw.Status.Listeners)
      d.Details = gatewayDetailsSummary(d)
      return d
  }

  func buildGatewayListener(spec gatewayv1.Listener, statusList []gatewayv1.ListenerStatus) types.GatewayListener {
      l := types.GatewayListener{
          Name:     string(spec.Name),
          Port:     int32(spec.Port),
          Protocol: string(spec.Protocol),
          Hostname: stringFromPtr(spec.Hostname),
      }
      if spec.TLS != nil && spec.TLS.Mode != nil {
          l.TLSMode = string(*spec.TLS.Mode)
      }
      l.AllowedRoutesSummary = allowedRoutesSummary(spec.AllowedRoutes)
      // find matching ListenerStatus
      for _, ls := range statusList {
          if string(ls.Name) == string(spec.Name) {
              l.ConditionsSummary = summarizeConditions(ls.Conditions, "Programmed", "Accepted", "ResolvedRefs")
              break
          }
      }
      return l
  }

  func listenerStatusCounts(statuses []gatewayv1.ListenerStatus) string {
      total := len(statuses)
      programmed := 0
      for _, s := range statuses {
          for _, c := range s.Conditions {
              if c.Type == "Programmed" && c.Status == metav1.ConditionTrue {
                  programmed++
                  break
              }
          }
      }
      if total == 0 { return "" }
      return fmt.Sprintf("%d/%d programmed", programmed, total)
  }

  func allowedRoutesSummary(ar *gatewayv1.AllowedRoutes) string {
      if ar == nil || ar.Namespaces == nil { return "" }
      from := "Same"
      if ar.Namespaces.From != nil { from = string(*ar.Namespaces.From) }
      return fmt.Sprintf("from=%s", from)
  }

  func gatewayDetailsSummary(d *types.GatewayDetails) string {
      parts := []string{fmt.Sprintf("Listeners: %d", len(d.Listeners))}
      if len(d.Addresses) > 0 { parts = append(parts, "LB: "+d.Addresses[0].Value) }
      return strings.Join(parts, ", ")
  }

  func stringFromPtr[T ~string](p *T) string {
      if p == nil { return "" }
      return string(*p)
  }
  ```

  (`common.FormatAge` already exists per `backend/resources/network/ingresses.go`.)

- [ ] **Step 4: Unskip** `TestNewService_NilClient` in `service_test.go` — it
  now compiles and passes.

- [ ] **Step 5: Run** all tests — expect PASS.

- [ ] **Step 6: Pause for commit.** Per Conventions, the agent does NOT run the commit. Report task complete. Suggested user-run message: `feat(gatewayapi): Gateway handler + builder`

---

### Task 9: HTTPRoute handler + builder

**Files:**
- Create: `backend/resources/gatewayapi/httproute.go`
- Create: `backend/resources/gatewayapi/httproute_test.go`

- [ ] **Step 1: Write failing tests** covering: NotInstalled error path
  (mirror Task 8); empty Hostnames + zero rules; multiple rules with
  multiple `BackendRefs`; `ParentRefs` to a `Gateway` (resolves) and to an
  unknown-version custom kind (DisplayRef branch); `ParentStatuses` with
  Accepted=True / ResolvedRefs=False.

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement** `httproute.go`. Same `ensureKind("HTTPRoute")` +
  `Get`/`List` skeleton as `gateway.go`, plus:

  ```go
  func buildHTTPRouteDetails(clusterID string, r *gatewayv1.HTTPRoute, vr common.VersionResolver) *types.HTTPRouteDetails {
      d := &types.HTTPRouteDetails{
          DetailsEnvelope: types.DetailsEnvelope{
              Kind: "HTTPRoute", Name: r.Name, Namespace: r.Namespace,
              Age: common.FormatAge(r.CreationTimestamp.Time),
              Labels: r.Labels, Annotations: r.Annotations,
          },
      }
      for _, h := range r.Spec.Hostnames {
          d.Hostnames = append(d.Hostnames, string(h))
      }
      for _, pr := range r.Spec.ParentRefs {
          d.ParentRefs = append(d.ParentRefs, ParentRefToRefOrDisplay(clusterID, r.Namespace, pr, vr))
      }
      for _, rule := range r.Spec.Rules {
          out := types.RouteRule{MatchSummary: httpMatchSummary(rule.Matches)}
          for _, br := range rule.BackendRefs {
              entry := types.BackendRef{
                  Ref: BackendRefToRefOrDisplay(clusterID, r.Namespace, br.BackendRef.BackendObjectReference, vr),
              }
              if br.Weight != nil {
                  entry.Weight = *br.Weight
              }
              // br.Port is *gatewayv1.PortNumber (an int32 typedef).
              if br.Port != nil {
                  entry.Port = int32(*br.Port)
              }
              out.BackendRefs = append(out.BackendRefs, entry)
          }
          d.Rules = append(d.Rules, out)
      }
      for _, p := range r.Status.Parents {
          d.ParentStatuses = append(d.ParentStatuses, types.RouteParentStatus{
              Parent:     ParentRefToRefOrDisplay(clusterID, r.Namespace, p.ParentRef, vr),
              Conditions: summarizeConditions(p.Conditions, "Accepted", "ResolvedRefs"),
          })
      }
      d.Details = routeDetailsSummary(d.Hostnames, d.Rules)
      return d
  }

  // httpMatchSummary renders a route match list as a single human string.
  // Format examples:
  //   "" (no matches)
  //   "PathPrefix /api"
  //   "Exact /healthz, Header x-foo=bar"
  //   "PathPrefix /api +1 more"
  func httpMatchSummary(ms []gatewayv1.HTTPRouteMatch) string {
      if len(ms) == 0 { return "" }
      first := ms[0]
      var parts []string
      if first.Path != nil && first.Path.Value != nil {
          t := "PathPrefix"
          if first.Path.Type != nil { t = string(*first.Path.Type) }
          parts = append(parts, fmt.Sprintf("%s %s", t, *first.Path.Value))
      }
      for _, h := range first.Headers {
          parts = append(parts, fmt.Sprintf("Header %s=%s", h.Name, h.Value))
      }
      s := strings.Join(parts, ", ")
      if len(ms) > 1 { s += fmt.Sprintf(" +%d more", len(ms)-1) }
      return s
  }

  func routeDetailsSummary(hostnames []string, rules []types.RouteRule) string {
      var parts []string
      if len(hostnames) > 0 { parts = append(parts, "Hosts: "+hostnames[0]) }
      backends := 0
      for _, r := range rules { backends += len(r.BackendRefs) }
      if backends > 0 { parts = append(parts, fmt.Sprintf("Backends: %d", backends)) }
      return strings.Join(parts, ", ")
  }
  ```

- [ ] **Step 4: Run** — expect PASS.

- [ ] **Step 5: Pause for commit.** Per Conventions, the agent does NOT run the commit. Report task complete. Suggested user-run message: `feat(gatewayapi): HTTPRoute handler + builder`

---

### Task 10: GRPCRoute handler + builder

Same structure as Task 9, against `gatewayv1.GRPCRoute`. The match-summary
helper differs (gRPC uses `Method`, `Service` matches instead of paths/headers):

```go
func grpcMatchSummary(ms []gatewayv1.GRPCRouteMatch) string {
    if len(ms) == 0 { return "" }
    first := ms[0]
    if first.Method != nil {
        s := strOrDefault(first.Method.Service, "*")
        m := strOrDefault(first.Method.Method, "*")
        return fmt.Sprintf("Method %s/%s", s, m)
    }
    return ""
}
```

The rest of the builder mirrors `buildHTTPRouteDetails` — copy and adapt
field names. Tests mirror Task 9.

- [ ] **Steps 1-5** identical to Task 9's flow against GRPCRoute.
- [ ] **Step 6: Pause for commit.** Per Conventions, the agent does NOT run the commit. Report task complete. Suggested user-run message: `feat(gatewayapi): GRPCRoute handler + builder`

---

### Task 11: TLSRoute handler + builder

Same structure. TLSRoute has `Hostnames` + `ParentRefs` + `Rules` (each rule
is a `BackendRefs` only — no matches). `tlsRouteDetailsSummary` reads
"Hosts: ..., Backends: N". Otherwise identical to Tasks 9/10.

- [ ] **Steps 1-5** identical.
- [ ] **Step 6: Pause for commit.** Per Conventions, the agent does NOT run the commit. Report task complete. Suggested user-run message: `feat(gatewayapi): TLSRoute handler + builder`

---

### Task 12: GatewayClass handler + builder (cluster-scoped)

**Files:**
- Create: `backend/resources/gatewayapi/gatewayclass.go`
- Create: `backend/resources/gatewayapi/gatewayclass_test.go`

- [ ] **Step 1: Write failing tests.** `Service.GatewayClass(name)` and
  `Service.GatewayClasses()` (no namespace). `UsedBy` populated by passing a
  `GatewayLister` that returns Gateways referencing the class — assert
  cross-namespace `UsedBy` collection.

- [ ] **Step 2-3: Implement.**

  ```go
  func (s *Service) GatewayClass(name string) (*types.GatewayClassDetails, error) {
      if err := s.ensureKind("GatewayClass"); err != nil { return nil, err }
      gc, err := s.deps.GatewayClient.GatewayV1().GatewayClasses().Get(s.deps.Context, name, metav1.GetOptions{})
      if err != nil { return nil, err }
      var refs []*gatewayv1.Gateway
      // Best-effort: list all Gateways and filter by GatewayClassName == name.
      // If the Gateway kind is absent, UsedBy is left empty.
      if s.deps.GatewayAPIPresence.Has("Gateway") {
          all, err := s.deps.GatewayClient.GatewayV1().Gateways("").List(s.deps.Context, metav1.ListOptions{})
          if err == nil {
              for i := range all.Items {
                  if string(all.Items[i].Spec.GatewayClassName) == name {
                      refs = append(refs, &all.Items[i])
                  }
              }
          }
      }
      return buildGatewayClassDetails(s.deps.ClusterID, gc, refs), nil
  }

  func buildGatewayClassDetails(clusterID string, gc *gatewayv1.GatewayClass, usedBy []*gatewayv1.Gateway) *types.GatewayClassDetails {
      d := &types.GatewayClassDetails{
          DetailsEnvelope: types.DetailsEnvelope{
              Kind: "GatewayClass", Name: gc.Name,
              Age: common.FormatAge(gc.CreationTimestamp.Time),
              Labels: gc.Labels, Annotations: gc.Annotations,
          },
          ControllerName:    string(gc.Spec.ControllerName),
          Description:       stringFromPtr(gc.Spec.Description),
          ConditionsSummary: summarizeConditions(gc.Status.Conditions, "Accepted"),
      }
      // status.supportedFeatures is a []SupportedFeature, NOT a condition.
      for _, f := range gc.Status.SupportedFeatures {
          d.SupportedFeatures = append(d.SupportedFeatures, string(f.Name))
      }
      for _, gw := range usedBy {
          d.UsedBy = append(d.UsedBy, types.ObjectRef{
              ClusterID: clusterID, Group: gatewayAPIGroup, Version: "v1",
              Kind: "Gateway", Namespace: gw.Namespace, Name: gw.Name,
          })
      }
      d.Details = fmt.Sprintf("Controller: %s", d.ControllerName)
      if len(d.UsedBy) > 0 { d.Details += fmt.Sprintf(", Used by %d gateway(s)", len(d.UsedBy)) }
      return d
  }
  ```

- [ ] **Steps 4-5:** Run all tests; expect PASS. Then **pause for commit** (agent does not run it). Suggested message: `feat(gatewayapi): GatewayClass handler + builder`

---

### Task 13: ListenerSet handler + builder

`ListenerSet` is namespaced. Builder shape mirrors `Gateway` for listeners.
`spec.parentRef` is a single `ParentReference` to a Gateway.

- [ ] **Steps 1-5:** Tests + impl, then **pause for commit** (agent does not run it). Suggested message: `feat(gatewayapi): ListenerSet handler + builder`

---

### Task 14: ReferenceGrant handler + builder

The `From` slice → `ReferenceGrantFrom`; the `To` slice → `ReferenceGrantTo`
where each entry's `Target` is a `RefOrDisplay` only when `name` is set.

```go
for _, t := range rg.Spec.To {
    e := types.ReferenceGrantTo{Group: string(t.Group), Kind: string(t.Kind)}
    if t.Name != nil && *t.Name != "" {
        ref := LocalObjectRefToRefOrDisplay(clusterID, rg.Namespace, string(t.Group), string(t.Kind), string(*t.Name), vr)
        e.Target = &ref
    }
    d.To = append(d.To, e)
}
```

- [ ] **Steps 1-5** + **pause for commit** (agent does not run it). Suggested message: `feat(gatewayapi): ReferenceGrant handler + builder`

---

### Task 15: BackendTLSPolicy handler + builder

Includes `AncestorStatuses` populated from `status.ancestors[]`.

```go
for _, a := range pol.Status.Ancestors {
    d.AncestorStatuses = append(d.AncestorStatuses, types.PolicyAncestorStatus{
        Ancestor:       ParentRefToRefOrDisplay(clusterID, pol.Namespace, a.AncestorRef, vr),
        ControllerName: string(a.ControllerName),
        Conditions:     summarizeConditions(a.Conditions, "Accepted", "ResolvedRefs"),
    })
}
```

`Validation.CACertificateRefs` resolves to `[]ObjectRef` (always v1
ConfigMap/Secret per hardcoded defaults).

- [ ] **Steps 1-5** + **pause for commit** (agent does not run it). Suggested message: `feat(gatewayapi): BackendTLSPolicy handler + builder`

---

### Task 16: `testsupport/gatewayapi.go` fixtures

**Files:**
- Create: `backend/testsupport/gatewayapi.go`

These fixtures should already have been used in Tasks 8-15 — write them
inline-first per task and consolidate here when the patterns repeat.

- [ ] **Step 1: Migrate** repeated builders (`NewGateway`, `WithListener`,
  `NewHTTPRoute`, `NewGRPCRoute`, etc.) from individual `_test.go` files into
  `backend/testsupport/gatewayapi.go`, mirroring the existing
  `NewIngressLister`/`NewIngressClassLister` style.

- [ ] **Step 2: Add fake-lister helpers** (`NewGatewayLister`,
  `NewHTTPRouteLister`, etc.) for use by snapshot tests in later tasks.

- [ ] **Step 3: Run** all backend tests — expect PASS.

- [ ] **Step 4: Pause for commit.** Per Conventions, the agent does NOT run the commit. Report task complete. Suggested user-run message: `test: extract gatewayapi testsupport fixtures`

---

### Task 17: Wire Gateway-API client + factory in `cluster_clients.go` and `resourceDependenciesForSelection`

**Files:**
- Modify: `backend/cluster_clients.go` (`clusterClients` struct + `New` flow)
- Modify: `backend/cluster_clients_test.go`
- Modify: `backend/resources_workloads.go` (`resourceDependenciesForSelection`)
- Modify: `backend/cluster_dependencies.go` (read-through helper, if it
  shadows the Deps fields)

**Why both files matter:** `clusterClients` stores the per-cluster client
bundle, but the `common.Dependencies` value passed into resource handlers
is built by `resourceDependenciesForSelection` reading from `clusterClients`.
If only the struct is extended, the new fields never reach handlers and
every call returns `ErrGatewayAPINotInstalled` regardless of presence.

- [ ] **Step 1: Write failing tests.**

  ```go
  // cluster_clients_test.go
  func TestClusterClients_GatewayAPIAbsent(t *testing.T) {
      // crd lister contains zero Gateway-API CRDs → clients.gatewayClient nil,
      // clients.gatewayAPIPresence.AnyPresent() == false.
  }
  func TestClusterClients_GatewayAPIPresent(t *testing.T) {
      // crd lister contains a Gateway CRD → clients.gatewayClient non-nil,
      // clients.gatewayAPIPresence.Gateway == true,
      // clients.gatewayInformerFactory non-nil and started.
  }

  // resources_workloads_test.go (or wherever resourceDependenciesForSelection is tested)
  func TestResourceDependenciesForSelection_PropagatesGatewayAPI(t *testing.T) {
      clients := &clusterClients{
          gatewayClient:        gatewayfake.NewSimpleClientset(),
          gatewayAPIPresence:   gatewayapi.GatewayAPIPresence{Gateway: true},
          gatewayVersionResolver: stubResolver{},
      }
      deps := app.resourceDependenciesForSelection(selection, clients, "c1")
      require.NotNil(t, deps.GatewayClient)
      require.True(t, deps.GatewayAPIPresence.Has("Gateway"))
      require.NotNil(t, deps.GatewayVersionResolver)
  }
  ```

- [ ] **Step 2: Run** — expect FAIL (struct fields missing).

- [ ] **Step 3: Extend the `clusterClients` struct.** In
  `backend/cluster_clients.go`:

  ```go
  type clusterClients struct {
      // …existing fields…
      gatewayClient          gatewayversioned.Interface             // nil when AnyPresent==false
      gatewayInformerFactory gatewayinformers.SharedInformerFactory // nil when AnyPresent==false
      gatewayAPIPresence     gatewayapi.GatewayAPIPresence
      gatewayVersionResolver common.VersionResolver                 // populated in Task 19
  }
  ```

- [ ] **Step 4: Populate during init.** **Important:** at the point in
  `cluster_clients.go` where this runs, only the normal Kubernetes client
  exists. The apiextensions *informer factory* is created later in the
  refresh subsystem, so the discovery code cannot use a CRD lister here.
  Instead, use the API discovery endpoint and adapt:

  ```go
  // Discovery must NOT fail cluster init when CRD list is denied or the
  // discovery group is unreachable; missing visibility into Gateway API is
  // semantically equivalent to "not installed for this user."
  var gatewayPresence gatewayapi.GatewayAPIPresence
  var gatewayClient gatewayversioned.Interface
  var gatewayInformerFactory gatewayinformers.SharedInformerFactory

  presence, err := gatewayapi.DiscoverViaDiscovery(ctx, clientset.Discovery())
  if err != nil {
      // Logged-and-degrade: Gateway-API features simply won't appear.
      if a.logger != nil {
          a.logger.Warn(fmt.Sprintf("gateway-api discovery failed: %v; treating as absent", err))
      }
      presence = gatewayapi.GatewayAPIPresence{}
  }
  gatewayPresence = presence

  if presence.AnyPresent() {
      gwClient, err := gatewayversioned.NewForConfig(config)
      if err != nil { return nil, fmt.Errorf("gateway-api clientset: %w", err) }
      gatewayClient = gwClient
      gatewayInformerFactory = gatewayinformers.NewSharedInformerFactory(gwClient, appconfig.RefreshResyncInterval)
      // Start + WaitForCacheSync occurs alongside the existing factories.
  }
  ```

  Add `gatewayClient`, `gatewayInformerFactory`, and `gatewayPresence` to the
  `clusterClients` struct literal returned at the end of
  `buildClusterClientsWithContext`. Do not use a nonexistent local named `c`;
  this function currently builds locals (`clientset`, `config`, etc.) and then
  returns a struct literal. Add the internal config import as an alias such as
  `appconfig "github.com/luxury-yacht/app/backend/internal/config"` so it does
  not collide with the existing local `config *rest.Config`.

  **Use the discovery API, not the CRD list.** Listing
  `apiextensions.k8s.io/v1` CRDs requires `customresourcedefinitions` list
  permission, which is commonly restricted (most user-bound RBAC roles do
  not grant it). Asking the API server's discovery endpoint for served
  resources in `gateway.networking.k8s.io/v1` works under default RBAC
  (`system:discovery` is granted to all authenticated users) and gives
  the same answer for our purpose: "is `<kind>` a real, served resource
  on this cluster?"

  Add `DiscoverViaDiscovery(ctx, d discovery.DiscoveryInterface)` to
  `discover.go` (alongside `Discover`). Implementation:

  ```go
  func DiscoverViaDiscovery(ctx context.Context, d discovery.DiscoveryInterface) (GatewayAPIPresence, error) {
      list, err := d.ServerResourcesForGroupVersion(gatewayAPIGroup + "/v1")
      if err != nil {
          // NotFound is the expected absent case. Forbidden / network errors
          // get returned to the caller, which (per cluster_clients.go above)
          // logs and degrades to "absent".
          if apierrors.IsNotFound(err) {
              return GatewayAPIPresence{}, nil
          }
          return GatewayAPIPresence{}, err
      }
      var p GatewayAPIPresence
      for _, r := range list.APIResources {
          // Skip subresources (e.g. "gateways/status").
          if strings.Contains(r.Name, "/") { continue }
          switch r.Kind {
          case "Gateway":          p.Gateway          = true
          case "GatewayClass":     p.GatewayClass     = true
          case "HTTPRoute":        p.HTTPRoute        = true
          case "GRPCRoute":        p.GRPCRoute        = true
          case "TLSRoute":         p.TLSRoute         = true
          case "ListenerSet":      p.ListenerSet      = true
          case "ReferenceGrant":   p.ReferenceGrant   = true
          case "BackendTLSPolicy": p.BackendTLSPolicy = true
          }
      }
      return p, nil
  }
  ```

  Add unit coverage in `discover_test.go` against
  `k8s.io/client-go/discovery/fake.FakeDiscovery`: empty group →
  no presence; group with subset of kinds → matching subset;
  `IsNotFound` → empty presence + nil error; non-NotFound error → bubbled
  to caller (production path then degrades to absent).

  The existing CRD-lister-based `Discover` in `discover.go` stays in
  place for tests that already use it (Task 4); production now uses
  `DiscoverViaDiscovery`.

  `gatewayVersionResolver` is populated in Task 19 once the object catalog
  is constructed.

- [ ] **Step 5: Update `resourceDependenciesForSelection`** in
  `backend/resources_workloads.go`. Add the three new field assignments
  *inside* the `if clients == nil { return deps }` guard (so an unknown
  cluster yields nil/zero-valued fields):

  ```go
  deps.GatewayClient        = clients.gatewayClient
  deps.GatewayAPIPresence   = clients.gatewayAPIPresence
  deps.GatewayVersionResolver = clients.gatewayVersionResolver
  ```

  Verify that any helper which builds a partial `Dependencies` (e.g. paths
  used by tests or the object-detail provider's deps lookup in
  `cluster_dependencies.go`) carries these fields the same way.

- [ ] **Step 6: Run** — expect PASS.

- [ ] **Step 7: Pause for commit.** Suggested message: `feat: discovery-gated Gateway API clientset + dependency wiring`

---

### Task 17a: Thread Gateway-API factory + presence through `system.Config`

**Files:**
- Modify: `backend/refresh/system/manager.go` (or wherever `system.Config` lives)
- Modify: `backend/app_refresh_setup.go`
- Modify: `backend/refresh/system/manager_test.go` (or equivalent)

**Why this task exists:** the refresh subsystem is built in
`backend/app_refresh_setup.go:154` from a `system.Config`. Tasks 17, 18,
and 22a all assume the system manager already holds the Gateway-API
factory + presence — but nothing in the plan actually adds those fields
to `system.Config` or populates them from `clusterClients`. Without this
wire-through the refresh subsystem can't see them at all and Tasks 18 / 22a
have no real input.

**Ordering:** Task 17a runs **before** Task 18 in the build dependency
graph. To keep 17a self-contained, this task introduces the minimal
informer-wrapper plumbing it needs (the field + setter + accessor); Task
18 then extends that wrapper with start/sync logic.

- [ ] **Step 1: Write failing test.** In `manager_test.go`, assert that a
  `system.Config` carrying a non-nil `GatewayInformerFactory` and a presence
  with `Gateway: true` produces a `Subsystem` whose informer factory wrapper
  exposes the same Gateway factory (the `WithGatewayFactory` setter from this
  task takes effect).

- [ ] **Step 2: Run** — expect FAIL (fields missing).

- [ ] **Step 3a: Add minimal informer-wrapper plumbing.** In
  `backend/refresh/informer/factory.go`, add the field/setter/accessor
  block below **and** an exported helper that lets external packages
  contribute `cache.InformerSynced` funcs to the same `f.syncedFns`
  slice the kube/apiext factories use. Without this helper, the
  refresh-domain constructors in Tasks 21/22 have no way to feed Gateway
  informer sync state into the wrapper's single `WaitForCacheSync` call —
  `registerInformer` is unexported, so snapshot packages cannot append.

  ```go
  // gatewayFactory stored on the wrapper; nil when AnyPresent==false.
  gatewayFactory gatewayinformers.SharedInformerFactory
  // presence stored alongside, exposed via accessor.
  gatewayPresence gatewayapi.GatewayAPIPresence

  // WithGatewayFactory configures the optional Gateway-API factory.
  // Idempotent. Safe to call with a nil factory.
  func (f *Factory) WithGatewayFactory(g gatewayinformers.SharedInformerFactory) *Factory {
      f.gatewayFactory = g
      return f
  }

  // WithGatewayAPIPresence sets the per-kind presence struct.
  func (f *Factory) WithGatewayAPIPresence(p gatewayapi.GatewayAPIPresence) *Factory {
      f.gatewayPresence = p
      return f
  }

  // GatewayInformerFactory returns the optional Gateway-API factory (may be nil).
  // Used by app_object_catalog.go and the response-cache invalidation setup.
  func (f *Factory) GatewayInformerFactory() gatewayinformers.SharedInformerFactory {
      return f.gatewayFactory
  }

  // GatewayAPIPresence returns the per-kind presence struct.
  func (f *Factory) GatewayAPIPresence() gatewayapi.GatewayAPIPresence {
      return f.gatewayPresence
  }

  // RegisterInformerSynced lets refresh-domain registration code contribute
  // HasSynced funcs into the same slice that Start blocks on. It must be
  // called before Start. Calls after Start are a programming error because
  // they cannot join the initial ready wait.
  func (f *Factory) RegisterInformerSynced(fn cache.InformerSynced) {
      if fn == nil {
          return
      }
      f.syncedFnsMu.Lock()
      defer f.syncedFnsMu.Unlock()
      f.syncedFns = append(f.syncedFns, fn)
  }
  ```

  This step adds the storage / setter / accessor / sync-registration helper.
  Task 18 will add Start / WaitForCacheSync handling for the new factory;
  Tasks 21/22/22a call `RegisterInformerSynced` while refresh domains are
  registered, which happens before the manager starts.

- [ ] **Step 3b: Extend `system.Config`.** Add three new fields:

  ```go
  type Config struct {
      // …existing fields…
      GatewayClient          gatewayversioned.Interface             // nil when AnyPresent==false
      GatewayInformerFactory gatewayinformers.SharedInformerFactory // nil when AnyPresent==false
      GatewayAPIPresence     gatewayapi.GatewayAPIPresence
  }
  ```

  Update the system-manager constructor to:
  - call `informerFactory.WithGatewayFactory(cfg.GatewayInformerFactory)`
    and `informerFactory.WithGatewayAPIPresence(cfg.GatewayAPIPresence)` so
    both reach the wrapper;
  - store `gatewayClient` + `presence` on the dependency bundle that
    `registrations.go` reads (the same struct extended in Task 22a, which
    now sources its values from these `Config` fields rather than asking
    callers).

- [ ] **Step 4: Populate the config in `app_refresh_setup.go`.** In
  `buildRefreshSubsystemForSelection`, alongside the existing
  `KubernetesClient: clients.client` line:

  ```go
  cfg := system.Config{
      // …existing fields…
      GatewayClient:          clients.gatewayClient,
      GatewayInformerFactory: clients.gatewayInformerFactory,
      GatewayAPIPresence:     clients.gatewayAPIPresence,
  }
  ```

- [ ] **Step 5: Run** — expect PASS.

- [ ] **Step 6: Pause for commit.** Suggested message: `feat(refresh): thread gateway-api factory + presence into system.Config`

---

### Task 18: Extend `refresh/informer/factory.go` Start / WaitForCacheSync for dual-factory

**Files:**
- Modify: `backend/refresh/informer/factory.go`
- Modify: `backend/refresh/informer/factory_test.go`

**Note:** Task 17a already added the `gatewayFactory` /
`gatewayPresence` fields and their setters/accessors. This task adds only
the lifecycle handling — `Start` and `WaitForCacheSync` cover both
factories.

- [ ] **Step 1: Write failing tests** for: `Start` with nil `gatewayFactory`
  starts the kube factory only; with both factories starts both;
  `WaitForCacheSync` waits on both. Also assert that with `gatewayFactory`
  non-nil but `presence.AnyPresent()` false, no per-kind informer is
  started (defensive — `presence.AnyPresent()` should already gate factory
  construction in Task 17 Step 4, but the wrapper should not assume).

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement.** **Preserve the existing `Start(ctx
  context.Context) error` signature** at
  `backend/refresh/informer/factory.go:181` — do not change it. Existing
  callers depend on the `(ctx) → error` shape.

  The current body launches the kube + apiext factories *and then* runs a
  single `cache.WaitForCacheSync(ctx.Done(), f.syncedFns...)`, setting
  `startErr = context.Canceled` when sync fails. The Gateway factory must
  participate in that single sync wait — appending after `WaitForCacheSync`
  would mean it starts after the wait has already returned and the
  context-canceled path can't see Gateway sync status.

  Modify the body inside the existing `f.once.Do(...)` so the Gateway
  factory starts **before** the existing sync wait, and feeds its own
  `InformerSynced` functions into `f.syncedFns` first:

  ```go
  func (f *Factory) Start(ctx context.Context) error {
      var startErr error
      f.once.Do(func() {
          go f.factory.Start(ctx.Done())
          if f.apiextFactory != nil {
              go f.apiextFactory.Start(ctx.Done())
          }
          // ↓ NEW: must happen before WaitForCacheSync below so the
          // gateway factory's caches participate in the same wait.
          if f.gatewayFactory != nil && f.gatewayPresence.AnyPresent() {
              go f.gatewayFactory.Start(ctx.Done())
              // Per-kind informer materialization inside the gateway
              // factory is driven by lister/informer access in refresh
              // domain registration (Tasks 21/22/22a) and response-cache
              // invalidation setup (Task 25), all before Manager.Start.
              // Those sites call RegisterInformerSynced so their caches
              // participate in the shared wait below.
          }

          f.syncedFnsMu.Lock()
          syncedFns := append([]cache.InformerSynced(nil), f.syncedFns...)
          f.syncedFnsMu.Unlock()

          synced := cache.WaitForCacheSync(ctx.Done(), syncedFns...)
          f.syncedMu.Lock()
          f.synced = synced
          f.syncedMu.Unlock()
          if !synced {
              startErr = context.Canceled
          }
      })
      return startErr
  }
  ```

  This way Gateway-API informer sync failure participates in the
  existing `context.Canceled` failure path; `startErr` already exists,
  do **not** replace it with `return nil`.

  No change to `WaitForCacheSync`'s public shape. The same single
  `f.syncedFns` slice covers built-in/apiext informers plus any Gateway
  informers that refresh-domain registration materializes before Start.
  Copy `f.syncedFns` under `syncedFnsMu` before waiting so the exported
  pre-start registration helper cannot race with `Start`.

- [ ] **Step 4: Run** — expect PASS.

- [ ] **Step 4a: Update `Shutdown` to clear the gateway factory.** The
  existing `Shutdown` at `backend/refresh/informer/factory.go:220` clears
  `f.factory` and `f.apiextFactory` to allow GC during transport rebuilds.
  Add the equivalent for `gatewayFactory` and reset `gatewayPresence`:

  ```go
  // Inside Shutdown, alongside the existing f.factory = nil / f.apiextFactory = nil:
  f.gatewayFactory  = nil
  f.gatewayPresence = gatewayapi.GatewayAPIPresence{}
  ```

  Add a unit test asserting that after `Shutdown`, `GatewayInformerFactory()`
  returns nil and `GatewayAPIPresence().AnyPresent()` is false.

- [ ] **Step 5: Pause for commit.** Suggested message: `feat(refresh): dual-factory Start/WaitForCacheSync + Shutdown`

---

### Task 19: Extend `objectcatalog/informer_registry.go`

**Files:**
- Modify: `backend/objectcatalog/informer_registry.go`
- Modify: `backend/objectcatalog/informer_registry_test.go`
- Modify: `backend/objectcatalog/types.go` (extend `Dependencies`)
- Modify: `backend/objectcatalog/collect.go` (`collectViaSharedInformer`
  call sites consume the new factory + presence)
- Modify: `backend/objectcatalog/service.go` (prepare Gateway informers before
  the catalog run loop starts)
- Modify: `backend/app_object_catalog.go` (the catalog deps assembly that
  builds an `objectcatalog.Dependencies` from the refresh subsystem)
- Modify: `backend/objectcatalog/watch.go` (reactive watch handlers — see
  Step 6)

**Why this task is non-trivial:** the existing `sharedInformerListers` map
in `informer_registry.go` is statically typed around
`informers.SharedInformerFactory` — every registration takes the built-in
factory as input. Gateway-API listers come from a different factory type
(`gatewayinformers.SharedInformerFactory`), so they can't be added to that
same map without changing its value-builder signature. This task introduces
a parallel registry keyed off `schema.GroupResource` whose entries take a
`gatewayinformers.SharedInformerFactory`, then merges the two maps at the
catalog-collection call site.

- [ ] **Step 1: Write failing tests** asserting that:
  - When `presence.AnyPresent()` is false, the catalog's collected GVRs
    contain none of the Gateway-API resources (registry is effectively
    empty for that group).
  - When `presence.Gateway=true` only, exactly one registration (`gateways`)
    appears, and per-kind absence (e.g. HTTPRoute false) leaves
    `httproutes` unregistered.
  - `PrepareGatewayInformers` materializes the present Gateway informers
    before `svc.Run(ctx)` and is idempotent.
  - The catalog's `Watch` events for a Gateway object trigger reactive
    catalog updates exactly like the built-in informer path does for an
    Ingress.

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Add a parallel registry.** In `informer_registry.go` next to
  `sharedInformerListers`:

  These catalog constructors may run after the refresh manager has already
  started. Do **not** use them to feed the refresh wrapper's initial
  `WaitForCacheSync`; that pre-start registration belongs in the refresh
  domain constructors in Tasks 21/22/22a. If object catalog materializes a
  Gateway informer that was not already requested by refresh-domain
  registration, Step 6a starts the Gateway factory again and waits locally
  before `svc.Run(ctx)`.

  ```go
  // gatewayInformerListers is the parallel registry for Gateway API kinds.
  // Each constructor materializes the informer for catalog list calls.
  var gatewayInformerListers = map[schema.GroupResource]func(
      factory gatewayinformers.SharedInformerFactory,
  ) informerListFunc{
      {Group: "gateway.networking.k8s.io", Resource: "gateways"}: func(f gatewayinformers.SharedInformerFactory) informerListFunc {
          inf := f.Gateway().V1().Gateways()
          lister := inf.Lister()
          return newNamespacedLister(
              func() ([]*gatewayv1.Gateway, error) { return lister.List(labels.Everything()) },
              func(ns string) ([]*gatewayv1.Gateway, error) { return lister.Gateways(ns).List(labels.Everything()) },
          )
      },
      // …repeat for httproutes, grpcroutes, tlsroutes, listenersets,
      // referencegrants, backendtlspolicies.
  }

  // gatewayInformerListersClusterScoped — separate map for cluster-scoped
  // GatewayClass.
  var gatewayInformerListersClusterScoped = map[schema.GroupResource]func(
      factory gatewayinformers.SharedInformerFactory,
  ) informerListFunc{
      {Group: "gateway.networking.k8s.io", Resource: "gatewayclasses"}: func(f gatewayinformers.SharedInformerFactory) informerListFunc {
          inf := f.Gateway().V1().GatewayClasses()
          lister := inf.Lister()
          return newClusterScopedLister(
              func() ([]*gatewayv1.GatewayClass, error) { return lister.List(labels.Everything()) },
          )
      },
  }
  ```

- [ ] **Step 4: Add a registration helper** that walks both registries and
  applies presence:

  ```go
  func registerGatewayAPIListers(
      registry map[schema.GroupResource]informerListFunc,
      factory gatewayinformers.SharedInformerFactory,
      presence gatewayapi.GatewayAPIPresence,
  ) {
      if factory == nil || !presence.AnyPresent() {
          return
      }
      kindForResource := map[string]string{
          "gateways":            "Gateway",
          "gatewayclasses":      "GatewayClass",
          "httproutes":          "HTTPRoute",
          "grpcroutes":          "GRPCRoute",
          "tlsroutes":           "TLSRoute",
          "listenersets":        "ListenerSet",
          "referencegrants":     "ReferenceGrant",
          "backendtlspolicies":  "BackendTLSPolicy",
      }
      for gr, ctor := range gatewayInformerListers {
          if presence.Has(kindForResource[gr.Resource]) {
              registry[gr] = ctor(factory)
          }
      }
      for gr, ctor := range gatewayInformerListersClusterScoped {
          if presence.Has(kindForResource[gr.Resource]) {
              registry[gr] = ctor(factory)
          }
      }
  }
  ```

  **Lifecycle rule:** object catalog starts after refresh manager startup in
  the current app flow, so these constructors must not assume they can
  influence the refresh wrapper's initial ready signal. Gateway informers
  needed by refresh snapshots are materialized and registered in Tasks
  21/22/22a before manager start. Catalog-created Gateway informers are
  handled by the catalog-specific `Start`/`WaitForCacheSync` in Step 6a.

- [ ] **Step 5a: Extend `objectcatalog.Dependencies`.** In
  `backend/objectcatalog/types.go`, add to the struct:

  ```go
  GatewayInformerFactory gatewayinformers.SharedInformerFactory // nil when AnyPresent==false
  GatewayAPIPresence     gatewayapi.GatewayAPIPresence
  ```

- [ ] **Step 5b: Populate from `app_object_catalog.go`.** In the
  `objectcatalog.Dependencies{...}` literal at
  `backend/app_object_catalog.go:163`, alongside the existing
  `InformerFactory: subsystem.InformerFactory.SharedInformerFactory()` line:

  ```go
  GatewayInformerFactory: subsystem.InformerFactory.GatewayInformerFactory(),
  GatewayAPIPresence:     subsystem.InformerFactory.GatewayAPIPresence(),
  ```

  These accessors `GatewayInformerFactory()` and
  `GatewayAPIPresence()` were added in Task 17a Step 3a — this step just
  consumes them.

- [ ] **Step 5c: Update the registry constructor.** Whatever
  `collectViaSharedInformer` (or its caller) currently does to populate
  per-cluster GVRs from `sharedInformerListers` now also calls
  `registerGatewayAPIListers(reg, deps.GatewayInformerFactory,
  deps.GatewayAPIPresence)` after the built-in entries are populated.
  Do not thread the refresh `informer.Factory` wrapper into object catalog
  for sync registration; object catalog is started after the refresh manager.

- [ ] **Step 5d: Add explicit catalog informer preparation.** Add an
  idempotent method on `objectcatalog.Service`, e.g.
  `PrepareGatewayInformers()`, that applies the same presence and permission
  gates as `collectViaSharedInformer`, materializes the relevant Gateway API
  informers (`.Informer()` / `.Lister()` access), and wires the catalog watch
  handlers from Step 6. Call this method from `app_object_catalog.go` after
  `svc := objectcatalog.NewService(deps, nil)` and before the goroutine that
  waits for caches and calls `svc.Run(ctx)`.

- [ ] **Step 6: Wire reactive watch handlers.** The catalog's existing
  watch path (`backend/objectcatalog/watch.go`) registers
  `cache.ResourceEventHandler`s on each built-in informer to surface
  catalog updates. Mirror this for each registered Gateway-API informer
  (one `AddEventHandler` per kind, gated on presence and permission) inside
  `PrepareGatewayInformers`. Without this, list responses appear but
  reactive UI updates do not.

- [ ] **Step 6a: Extend the cache-sync wait.** The catalog start path in
  `backend/app_object_catalog.go` (around the helpers calling
  `factory.WaitForCacheSync(ctx.Done())` at lines ~345 and ~361) currently
  waits only on the built-in `SharedInformerFactory` and the
  `APIExtensionsInformerFactory`. After `PrepareGatewayInformers` has
  materialized the Gateway-API listers/watch handlers, call
  `deps.GatewayInformerFactory.Start(ctx.Done())` and then
  `deps.GatewayInformerFactory.WaitForCacheSync(ctx.Done())` *before*
  `svc.Run(ctx)` (line 208), gated on `deps.GatewayInformerFactory != nil`.
  The extra `Start` call is intentional: client-go shared informer
  factories only start informers that had been requested when `Start` was
  previously called. Object catalog may request additional Gateway
  informers after the refresh manager's initial start, so the catalog must
  start the Gateway factory again before waiting. Without this, the catalog
  can serve requests before Gateway-API informers populate, producing
  transient empty results.

  Test: a fake gateway factory that delays its sync should block the
  catalog's `Run` until it completes. Assert the catalog yields the
  Gateway kinds in its first list call after sync.

- [ ] **Step 7: Add `PreferredVersion` adapter on `objectcatalog.Service`.**
  Expose `PreferredVersion(group, kind string) string` returning the
  preferred served version for a GVK, or `""` when the GVK is absent or
  ambiguous.

  **Source of truth — be explicit:** read from the catalog's existing
  **descriptor** map (`Descriptor` carries `Group`, `Version`, `Resource`
  and is built from API discovery during catalog warmup, not from the
  apiextensions CRD lister). The implementation walks the descriptors
  and indexes them by `(group, kind)` → version. The current catalog
  stores resource (`pods`, `httproutes`) rather than `Kind` (`Pod`,
  `HTTPRoute`); use the discovery `APIResource.Kind` field that's already
  available in the discovery walk to populate a kind-keyed index, or
  build a small kind→resource map alongside descriptors during warmup.

  **Do not add a new CRD-served-version index** (the apiext lister path)
  — it would duplicate state and introduces a second source of truth that
  could drift from the discovery-derived descriptors. The discovery path
  is the canonical one; if a GVK isn't in discovery, treat it as absent.

  Returns `""` for:
  - GVK absent from discovery.
  - GVK present in multiple groups with no clear preference (defensive;
    rare in practice for `(group, kind)` lookups since `kind` is unique
    within a group).

  Add unit coverage: resolves a built-in (`(\"\", \"Service\") → \"v1\"`),
  resolves a discovered CRD (`(\"custom.example.com\", \"Widget\") →
  \"v2\"`), returns `\"\"` for an absent GVK.

- [ ] **Step 8: Write the resolver back to `clusterClients`.** Modifying
  `Deps` alone is not enough — `resourceDependenciesForSelection` rebuilds
  `Dependencies` *fresh* from `clusterClients` on every call (see
  `backend/resources_workloads.go:104`). If only the catalog's local copy
  of `Deps` is mutated, the wrappers added in Task 26 will see a nil
  resolver because they go through `resourceDependenciesForSelection` from
  scratch.

  Two fixes, do both:

  1. **Eager assignment.** When the per-cluster `objectcatalog.Service` is
     constructed (`backend/app_object_catalog.go` startup path), assign
     back to `clusterClients`:

     ```go
     clients := a.clusterClientsForID(meta.ID)
     if clients != nil {
         a.clusterClientsMu.Lock()
         clients.gatewayVersionResolver = svc // svc.PreferredVersion(...) satisfies common.VersionResolver
         a.clusterClientsMu.Unlock()
     }
     ```

  2. **Lazy fallback.** In `resourceDependenciesForSelection`, when
     `clients.gatewayVersionResolver` is nil, attempt a live lookup through
     `a.objectCatalogServiceForCluster(clusterID)` and use that. This
     defends against the bootstrap window before the catalog has finished
     constructing.

  Add a test asserting both paths: eager (catalog already up) and lazy
  (catalog still constructing) yield a non-nil resolver in the deps the
  wrappers see.

- [ ] **Step 9: Run** — expect PASS.

- [ ] **Step 10: Pause for commit.** Suggested message: `feat(objectcatalog): conditionally register Gateway API listers + watch handlers + version resolver`

---

### Task 20: Extend `permission_checks.go`

**Files:**
- Modify: `backend/refresh/snapshot/permission_checks.go`
- Modify: `backend/refresh/snapshot/permission_checks_test.go`

**Two changes here, both required:** (a) the *startup-registration* gate
(spec entries used by `RegisterPermissionDeniedDomain`) referenced by
Tasks 21/22a, and (b) the *runtime / preflight* gate at
`permission_checks.go:181`, which is the per-domain capability map keyed
by `namespaceNetworkDomainName` and `clusterConfigDomainName`. Forgetting
(b) means permission revalidation and preflight checks ignore Gateway-API
permissions even when the registration is wired correctly.

| Kind | Resource |
| --- | --- |
| Gateway | gateways |
| GatewayClass | gatewayclasses |
| HTTPRoute | httproutes |
| GRPCRoute | grpcroutes |
| TLSRoute | tlsroutes |
| ListenerSet | listenersets |
| ReferenceGrant | referencegrants |
| BackendTLSPolicy | backendtlspolicies |

- [ ] **Step 1: Write failing tests** asserting:
  - The eight new startup permission specs are emitted with the correct
    `(group, resource)` pairs.
  - The runtime gate map for `namespaceNetworkDomainName` includes
    `requireAny` entries for the seven namespaced Gateway-API resources
    (alongside the existing `services`, `endpointslices`, `ingresses`,
    `networkpolicies`).
  - The runtime gate map for `clusterConfigDomainName` requires
    `gateway.networking.k8s.io/gatewayclasses` in its `requireAny` set.

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement (a) startup specs.** Add the eight entries.

- [ ] **Step 4: Implement (b) runtime gate.** Update the `namespaceNetworkDomainName` block in `permission_checks.go:181`:

  ```go
  namespaceNetworkDomainName: requireAny(
      "network resources",
      listPermission("", "services"),
      listPermission("discovery.k8s.io", "endpointslices"),
      listPermission("networking.k8s.io", "ingresses"),
      listPermission("networking.k8s.io", "networkpolicies"),
      listPermission("gateway.networking.k8s.io", "gateways"),
      listPermission("gateway.networking.k8s.io", "httproutes"),
      listPermission("gateway.networking.k8s.io", "grpcroutes"),
      listPermission("gateway.networking.k8s.io", "tlsroutes"),
      listPermission("gateway.networking.k8s.io", "listenersets"),
      listPermission("gateway.networking.k8s.io", "referencegrants"),
      listPermission("gateway.networking.k8s.io", "backendtlspolicies"),
  ),
  ```

  Update the `clusterConfigDomainName` block similarly to add
  `listPermission("gateway.networking.k8s.io", "gatewayclasses")`.

- [ ] **Step 5: Run** — expect PASS.

- [ ] **Step 6: Pause for commit.** Suggested message: `feat(refresh): startup + runtime permission gates for Gateway API`

---

### Task 21: Extend `namespace_network.go` snapshot domain

**Files:**
- Modify: `backend/refresh/snapshot/namespace_network.go`
- Modify: `backend/refresh/snapshot/namespace_network_test.go`

- [ ] **Step 1: Write failing tests** — one parallel sub-test per new kind
  asserting that with `IncludeXxx=true` and a fake lister returning two
  objects, the snapshot contains rows with the right `Kind`, `Details`, and
  `ClusterMeta`. Add nil-lister cases (CRD absent → no rows for that kind).

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement.** In `NamespaceNetworkPermissions` add fields:

  ```go
  IncludeGateways          bool
  IncludeHTTPRoutes        bool
  IncludeGRPCRoutes        bool
  IncludeTLSRoutes         bool
  IncludeListenerSets      bool
  IncludeReferenceGrants   bool
  IncludeBackendTLSPolicies bool
  ```

  In `NamespaceNetworkBuilder` add lister fields of the corresponding
  `gatewaylisters.*Lister` types. In `RegisterNamespaceNetworkDomain` (or
  the existing constructor) accept the refresh `*informer.Factory` wrapper
  plus presence. Use `wrapper.GatewayInformerFactory()` to get the typed
  Gateway factory, wire each lister conditionally, and immediately call
  `wrapper.RegisterInformerSynced(<informer>.Informer().HasSynced)` for each
  Gateway informer you materialize. This registration runs during
  `NewSubsystemWithServices`, before `Manager.Start`, so the Gateway caches
  participate in the initial refresh ready wait. In `Build`, add seven new
  branches that produce `NetworkSummary` rows. The Details summary string
  follows the design spec:

  - `Gateway`: `"Listeners: N"` + `", LB: <addr>"` if present.
  - Routes: `"Hosts: <first>, Backends: N"`.
  - `ListenerSet`: `"Parent: <gateway-name>, Listeners: N"`.
  - `ReferenceGrant`: `"From: N, To: M"`.
  - `BackendTLSPolicy`: `"Targets: N"`.

  Each new row's `Kind` is the canonical kind name (`"Gateway"`,
  `"HTTPRoute"`, …). `Resources` and `Kinds` are aggregated identically to
  the existing flow, then the truncation at `namespaceNetworkEntryLimit`
  (1000) applies.

- [ ] **Step 4: Run** — expect PASS.

- [ ] **Step 5: Pause for commit.** Per Conventions, the agent does NOT run the commit. Report task complete. Suggested user-run message: `feat(refresh): namespace-network domain emits Gateway API rows`

---

### Task 22: Extend `cluster_config.go` + `streaming_helpers.go` for `GatewayClass`

**Files:**
- Modify: `backend/refresh/snapshot/cluster_config.go`
- Modify: `backend/refresh/snapshot/streaming_helpers.go`
- Modify: `backend/refresh/snapshot/cluster_config_test.go`

- [ ] **Step 1: Write failing tests** for: `GatewayClass` row in the
  `cluster-config` snapshot when `IncludeGatewayClasses=true`; absent when
  the CRD is absent or the flag is false; `BuildClusterGatewayClassSummary`
  table-driven coverage (controller name, Accepted condition).

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement.** Add `IncludeGatewayClasses` flag, lister field
  (`gatewaylisters.GatewayClassLister`), and a `Build` branch that calls
  `BuildClusterGatewayClassSummary`. Accept the refresh `*informer.Factory`
  wrapper, get the typed Gateway factory through
  `wrapper.GatewayInformerFactory()`, and call
  `wrapper.RegisterInformerSynced(gatewayClassInformer.Informer().HasSynced)`
  when the lister is materialized. The summary mirrors
  `BuildClusterIngressClassSummary`.

- [ ] **Step 4: Run** — expect PASS.

- [ ] **Step 5: Pause for commit.** Per Conventions, the agent does NOT run the commit. Report task complete. Suggested user-run message: `feat(refresh): cluster-config domain emits GatewayClass rows`

---

### Task 22a: Update refresh-system registrations to pass Gateway API factory + presence

**Files:**
- Modify: `backend/refresh/system/registrations.go`
- Modify: `backend/refresh/system/manager.go` (the dependency-bundle field that
  already carries `informerFactory` — add `presence GatewayAPIPresence`).
- Modify: `backend/refresh/system/registrations_test.go`

**Why this task exists:** Tasks 21 and 22 changed the signatures of
  `snapshot.RegisterNamespaceNetworkDomain` and
  `snapshot.RegisterClusterConfigDomain` to require the refresh
  `*informer.Factory` wrapper and a per-kind presence struct. The call sites in
  `registrations.go` (around the existing `name: "cluster-config"` and
  `name: "namespace-network"` blocks) currently pass only the built-in
  `SharedInformerFactory()` and would no longer compile. Without this task,
Gateway API rows would never be wired into either domain.

- [ ] **Step 1: Write failing test.** In `registrations_test.go`, extend the
  existing fixtures so the registration manager bundle carries an
  `informerFactory` wrapper configured with a non-nil Gateway factory plus a
  presence struct with `Gateway: true, GatewayClass: true`. Assert the
  `cluster-config` registration's `register` callback receives
  `IncludeGatewayClasses=true` when the corresponding capability is allowed.
  Assert the `namespace-network` registration receives the seven new
  `IncludeXxx=true` flags when allowed.

- [ ] **Step 2: Run** — expect FAIL (compilation error: registration site
  doesn't pass the new args).

- [ ] **Step 3: Extend the registration-deps bundle.** In `manager.go`, add
  to whatever struct currently holds `informerFactory`:

  ```go
  presence       gatewayapi.GatewayAPIPresence
  ```

  The existing bundle already carries `informerFactory`; use that wrapper as
  the single source for both the built-in and Gateway factories. Plumb
  `presence` from `cfg.GatewayAPIPresence`.

- [ ] **Step 4: Update the `cluster-config` block** in `registrations.go`.
  Add a new `listCheck` for `gateway.networking.k8s.io/gatewayclasses`
  inside the existing `checks` slice. Update the `register` callback:

  ```go
  return snapshot.RegisterClusterConfigDomain(
      deps.registry,
      deps.informerFactory, // wrapper exposes both built-in + Gateway factories
      deps.presence,       // new
      snapshot.ClusterConfigPermissions{
          IncludeStorageClasses:     allowed["storage.k8s.io/storageclasses"],
          IncludeIngressClasses:     allowed["networking.k8s.io/ingressclasses"],
          IncludeValidatingWebhooks: allowed["admissionregistration.k8s.io/validatingwebhookconfigurations"],
          IncludeMutatingWebhooks:   allowed["admissionregistration.k8s.io/mutatingwebhookconfigurations"],
          IncludeGatewayClasses:     allowed["gateway.networking.k8s.io/gatewayclasses"], // new
      },
  )
  ```

  Update `issueResource` and `logResource` strings to mention
  `gatewayclasses`.

- [ ] **Step 5: Update the `namespace-network` block.** Add seven new
  `listCheck` entries (`gateways`, `httproutes`, `grpcroutes`, `tlsroutes`,
  `listenersets`, `referencegrants`, `backendtlspolicies`). Update the
  `register` callback to pass `deps.informerFactory`, `deps.presence`, and
  the seven new `IncludeXxx` flags. Update `issueResource` / `logResource`
  strings.

- [ ] **Step 6: Run** — expect PASS.

- [ ] **Step 7: Pause for commit.** Suggested message: `feat(refresh): wire gateway-api factory + presence through system registrations`

---

### Task 23: Extend `object_details.go` dispatch

**Files:**
- Modify: `backend/refresh/snapshot/object_details.go`
- Modify: `backend/refresh/snapshot/object_details_test.go`

- [ ] **Step 1: Write failing tests** asserting that for each of the eight
  kind aliases, the dispatch returns the typed `*Details` payload (use a
  fake `Service` that returns a known struct).

- [ ] **Step 2-4:** Add eight new entries to the kind dispatch map mirroring
  `"ingress"` and `"ingressclass"`. Cluster-scoped `gatewayclass` follows
  the cluster-scoped path used by `ingressclass`.

- [ ] **Step 5: Pause for commit.** Per Conventions, the agent does NOT run the commit. Report task complete. Suggested user-run message: `feat(refresh): object_details dispatch for Gateway API`

---

### Task 24: Extend `object_detail_provider.go` cache keys

**Files:**
- Modify: `backend/object_detail_provider.go`
- Modify: `backend/object_detail_provider_test.go`

- [ ] **Step 1-5:** Mirror the `"ingress"` / `"helmrelease"` cache-key
  entries. Eight new cache-key namespaces (`Gateway`, `GatewayClass`,
  `HTTPRoute`, `GRPCRoute`, `TLSRoute`, `ListenerSet`, `ReferenceGrant`,
  `BackendTLSPolicy`). Each provider entry calls
  `gatewayapi.NewService(deps).<Kind>(...)`. Tests verify cache hit/miss for
  each.

- [ ] **Pause for commit.** Per Conventions, the agent does NOT run the commit. Suggested user-run message: `feat: object detail provider entries for Gateway API kinds`

---

### Task 25: Extend `response_cache_invalidation.go` + register handlers against the Gateway informer

**Files:**
- Modify: `backend/response_cache_invalidation.go`
- Modify: `backend/response_cache_invalidation_test.go`
- Modify: the call site that wires invalidation to the per-cluster
  informers (the function calling `informer.AddEventHandler` at
  `backend/response_cache_invalidation.go:246` is invoked from a setup
  path that currently iterates only the built-in `SharedInformerFactory`
  + `APIExtensionsInformerFactory`; locate it via
  `git grep -n setupResponseCacheInvalidation` or similar and extend it).

**Why this is two-part:** the existing invalidation path (a) pulls watch
events from the built-in / apiext factories and (b) routes them through a
kind→invalidator dispatch. Adding the eight kind entries to (b) is
necessary but not sufficient — without (a) registering a
`cache.ResourceEventHandler` against each Gateway-API informer, no event
ever reaches the dispatch. The current setup reads only the kube + apiext
factories.

- [ ] **Step 1: Write failing tests** for:
  - Each of the eight kinds invalidates its own cache key on an Add /
    Update / Delete event delivered to the registered handler.
  - `Gateway` and `HTTPRoute` watch events additionally invalidate any
    cached `GatewayClass` detail.
  - The setup function registers a handler for a Gateway-API kind *only*
    when both `presence.Has(kind)` is true **and**
    `perms.CanListWatch("gateway.networking.k8s.io", resource)` returns
    true — mirroring the per-resource permission gate already in place at
    `backend/response_cache_invalidation.go:91-127`. Verify by combining a
    presence struct with all kinds true and a permissions stub that denies
    `httproutes`: assert `httproutes` informer's `AddEventHandler` is
    *not* called while `gateways` is.

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement (b) — kind dispatch.** Add the eight entries to
  the kind→invalidator routing table. Add the cross-invalidation hooks for
  Gateway / HTTPRoute → GatewayClass.

- [ ] **Step 4: Implement (a) — handler registration.** In the setup path
  that currently iterates `SharedInformerFactory()` + APIExtensions, mirror
  the existing per-resource gate pattern (compare
  `backend/response_cache_invalidation.go:91-127`, where every block reads
  `if perms == nil || perms.CanListWatch(group, resource) { …
  AddEventHandler … }`). Apply the same pattern, AND'd with per-kind
  presence:

  ```go
  if gwFactory != nil {
      gateGw := func(kind, resource string, informerFn func() cache.SharedIndexInformer) {
          if !presence.Has(kind) { return }
          if perms != nil && !perms.CanListWatch("gateway.networking.k8s.io", resource) { return }
          inf := informerFn()
          subsystem.InformerFactory.RegisterInformerSynced(inf.HasSynced)
          a.addResponseCacheInvalidationHandler(inf, selectionKey, kind, guard)
      }
      gateGw("Gateway",          "gateways",           func() cache.SharedIndexInformer { return gwFactory.Gateway().V1().Gateways().Informer() })
      gateGw("GatewayClass",     "gatewayclasses",     func() cache.SharedIndexInformer { return gwFactory.Gateway().V1().GatewayClasses().Informer() })
      gateGw("HTTPRoute",        "httproutes",         func() cache.SharedIndexInformer { return gwFactory.Gateway().V1().HTTPRoutes().Informer() })
      gateGw("GRPCRoute",        "grpcroutes",         func() cache.SharedIndexInformer { return gwFactory.Gateway().V1().GRPCRoutes().Informer() })
      gateGw("TLSRoute",         "tlsroutes",          func() cache.SharedIndexInformer { return gwFactory.Gateway().V1().TLSRoutes().Informer() })
      gateGw("ListenerSet",      "listenersets",       func() cache.SharedIndexInformer { return gwFactory.Gateway().V1().ListenerSets().Informer() })
      gateGw("ReferenceGrant",   "referencegrants",    func() cache.SharedIndexInformer { return gwFactory.Gateway().V1().ReferenceGrants().Informer() })
      gateGw("BackendTLSPolicy", "backendtlspolicies", func() cache.SharedIndexInformer { return gwFactory.Gateway().V1().BackendTLSPolicies().Informer() })
  }
  ```

  **The thunk pattern matters.** Calling `.Informer()` on a lister chain
  materializes the underlying shared informer. Go evaluates function
  arguments before the function body runs, so passing
  `gwFactory.Gateway().V1().HTTPRoutes().Informer()` *as a value* would
  materialize every kind's informer up-front — including the ones whose
  presence/permission gates fail inside `gateGw`. Wrapping each access in
  a `func() cache.SharedIndexInformer { … }` thunk defers the call until
  *after* the gate check passes, so denied / absent kinds never get an
  informer started.

  The `gwFactory` reaches this site via the same plumbing added in Task
  17a (`system.Config.GatewayInformerFactory`); `perms` is the existing
  permission checker the surrounding code already consults.

- [ ] **Step 5: Run** — expect PASS.

- [ ] **Step 6: Pause for commit.** Suggested message: `feat: response cache invalidation handlers for Gateway API`

---

### Task 26: App wrappers — `resources_gatewayapi.go`

**Files:**
- Create: `backend/resources_gatewayapi.go`
- Modify: `backend/resources_wrappers_test.go`

- [ ] **Step 1: Write failing tests** in `resources_wrappers_test.go` —
  mirror the existing matrix:

  ```go
  {"GatewayDetails",          func() error { _, err := app.GetGatewayDetails(clusterID, "ns", "demo"); return err }},
  {"HTTPRouteDetails",        func() error { _, err := app.GetHTTPRouteDetails(clusterID, "ns", "demo"); return err }},
  {"GRPCRouteDetails",        func() error { _, err := app.GetGRPCRouteDetails(clusterID, "ns", "demo"); return err }},
  {"TLSRouteDetails",         func() error { _, err := app.GetTLSRouteDetails(clusterID, "ns", "demo"); return err }},
  {"GatewayClassDetails",     func() error { _, err := app.GetGatewayClassDetails(clusterID, "demo"); return err }},
  {"ListenerSetDetails",      func() error { _, err := app.GetListenerSetDetails(clusterID, "ns", "demo"); return err }},
  {"ReferenceGrantDetails",   func() error { _, err := app.GetReferenceGrantDetails(clusterID, "ns", "demo"); return err }},
  {"BackendTLSPolicyDetails", func() error { _, err := app.GetBackendTLSPolicyDetails(clusterID, "ns", "demo"); return err }},
  // 8 details rows. List wrappers added only if a frontend caller emerges
  // (see Step 3 above); each addition gets its own row here at that point.
  ```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement.** Each *details* wrapper follows the existing
  `resources_helm.go` / `resources_network.go` pattern (e.g.
  `App.GetIngress` at `backend/resources_network.go:32`).

  **List wrappers are net-new API surface, not parity.** The existing
  network/helm wrappers expose only single-object `Get*` methods; the
  refresh subsystem's `namespace-network` snapshot already provides
  list-style data for namespace tables. The Gateway-API plan adds 8
  matching list wrappers (`ListGateways`, `ListHTTPRoutes`, …) **only if**
  a frontend caller needs them outside the snapshot path — for example,
  the `GatewayClass.UsedBy` builder in Task 12 calls
  `Service.Gateways("")` server-side (not via Wails), so it does not
  require a list wrapper.

  Default to **details wrappers only**: 8 methods total, including
  `GetGatewayClassDetails` for the cluster-scoped GatewayClass. If during
  Tasks 35-42 a frontend tab needs to list a kind directly, add the
  corresponding `List*` wrapper at that point and document it as new API
  surface.

  Per-kind details wrapper template:

  ```go
  func (a *App) GetGatewayDetails(clusterID, namespace, name string) (*GatewayDetails, error) {
      deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
      if err != nil { return nil, err }
      return FetchNamespacedResource(a, deps, selectionKey, "Gateway", namespace, name, func() (*GatewayDetails, error) {
          return gatewayapi.NewService(deps).Gateway(namespace, name)
      })
  }
  ```

  (Match the helper-name pattern used by `resources_helm.go` and
  `resources_network.go`. There is no `depsFor` in the current code.)

  Repeat for the other 7 details methods (one per remaining kind).
  `GetGatewayClassDetails` uses `FetchClusterResource` instead of
  `FetchNamespacedResource`. **Total: 8 wrappers, all `Get*Details`.** No
  `List*` wrappers in this task — see Step 3's "List wrappers are net-new
  API surface" decision above.

- [ ] **Step 4: Run** all backend tests — expect PASS.

- [ ] **Step 5: Pause for commit.** Per Conventions, the agent does NOT run the commit. Report task complete. Suggested user-run message: `feat: App wrappers for Gateway API kinds`

---

### Task 27: Frontend kind alias + view maps

**Files:**
- Modify: `frontend/src/utils/kindAliasMap.ts`
- Modify: `frontend/src/utils/kindAliasMap.test.ts`
- Modify: `frontend/src/utils/kindViewMap.ts`
- Modify: `frontend/src/utils/kindViewMap.test.ts`

- [ ] **Step 1: Write failing tests** asserting the eight new aliases and
  the eight kind→view mappings (seven → `network`, `GatewayClass` →
  `cluster-config`).

- [ ] **Step 2: Run** `vitest run frontend/src/utils/kindAliasMap.test.ts
  frontend/src/utils/kindViewMap.test.ts` — expect FAIL.

- [ ] **Step 3: Implement.** Append to `kindAliasMap.ts`:

  ```ts
  Gateway: 'gw',
  HTTPRoute: 'httproute',
  GRPCRoute: 'grpcroute',
  TLSRoute: 'tlsroute',
  GatewayClass: 'gwclass',
  ListenerSet: 'lset',
  ReferenceGrant: 'refgrant',
  BackendTLSPolicy: 'btlsp',
  ```

  And the reverse mapping (gw → Gateway, etc.). Append to `kindViewMap.ts`:

  ```ts
  Gateway: 'network',
  HTTPRoute: 'network',
  GRPCRoute: 'network',
  TLSRoute: 'network',
  ListenerSet: 'network',
  ReferenceGrant: 'network',
  BackendTLSPolicy: 'network',
  GatewayClass: 'cluster-config',
  ```

- [ ] **Step 4: Run** — expect PASS.

- [ ] **Step 5: Pause for commit.** Per Conventions, the agent does NOT run the commit. Report task complete. Suggested user-run message: `feat(frontend): register Gateway API kind aliases and view mappings`

---

### Task 28: Frontend `builtinGroupVersions` registration

**Files:**
- Modify: `frontend/src/shared/constants/builtinGroupVersions.ts`

- [ ] **Step 1-3:** Append eight entries mapping each Gateway API kind to
  group `gateway.networking.k8s.io` and version `v1`. Cover with a short
  test or extend the existing one.

- [ ] **Step 4: Pause for commit.** Per Conventions, the agent does NOT run the commit. Report task complete. Suggested user-run message: `feat(frontend): register gateway.networking.k8s.io/v1 GVs`

---

### Task 29: Frontend `permissionSpecs` + capabilities catalog

**Files:**
- Modify: `frontend/src/core/capabilities/permissionSpecs.ts`
- Modify: `frontend/src/core/capabilities/permissionSpecs.test.ts`
- Modify: `frontend/src/core/capabilities/catalog.ts`

- [ ] **Step 1: Write failing test** asserting eight new permission specs
  with verbs `list`/`watch`/`get`/`delete` against the right
  `(group, resource)` pairs (matching Task 20).

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement.** Mirror existing `Ingress`/`IngressClass`
  entries. CRD-not-installed is reflected by the backend emitting a distinct
  "not installed" reason that maps to a frontend capability state separate
  from "denied".

- [ ] **Step 4: Run** — expect PASS.

- [ ] **Step 5: Pause for commit.** Per Conventions, the agent does NOT run the commit. Report task complete. Suggested user-run message: `feat(frontend): capability + permission specs for Gateway API kinds`

---

### Task 30: Frontend `CommandPaletteCommands` kind-jump entries

**Files:**
- Modify: `frontend/src/ui/command-palette/CommandPaletteCommands.tsx`

- [ ] **Step 1-4:** Add eight new kind-jump entries; update the existing
  command-palette test to expect them.

- [ ] **Step 5: Pause for commit.** Per Conventions, the agent does NOT run the commit. Report task complete. Suggested user-run message: `feat(frontend): command palette entries for Gateway API kinds`

---

### Task 31: Frontend `ObjectDetailsSnapshotPayload` discriminator

**Files:**
- Modify: `frontend/src/core/refresh/types.ts`
- Modify: `frontend/src/modules/object-panel/components/ObjectPanel/Details/detailsTabTypes.ts`

- [ ] **Step 1: Write failing tests.** A short type-level test using
  `expectTypeOf` that asserts `ObjectDetailsSnapshotPayload` discriminator
  branches exist for each new kind, with the field shape from Task 3. Use
  the Wails-generated `frontend/wailsjs/go/backend` types as the source of
  truth — see Step 2 below for how to regenerate them (this repo has no
  `go generate ./...` target for Wails bindings; do not run it).

- [ ] **Step 2: Re-run Wails bindings.** This repo has **no dedicated
  binding-generation mage target**; bindings under
  `frontend/wailsjs/go/backend/` are emitted as a side effect of
  `wails dev` / `wails build` (mage wraps these in the platform-specific
  build targets — see `magefile.go:179` and `mage/macos.go:257`). The
  options:

  1. **Run a dev cycle.** `mage dev` (the project's dev wrapper around
     `wails dev`) regenerates bindings during startup. Stop the dev
     server once bindings appear in `frontend/wailsjs/go/backend/`.
  2. **Run `wails generate module`** directly from the project root if
     installed (matches the upstream Wails CLI; check the project's
     `go.mod` for the pinned `wailsapp/wails/v2` version, then run
     `wails generate module` from the same directory as `wails.json`).
  3. **Run `mage qc:prerelease`** (which performs the build path and
     therefore regenerates bindings) — slower but is the
     pre-merge gate already required by `AGENTS.md`.

  Verify that `frontend/wailsjs/go/backend/App.d.ts` now declares the 8
  details wrappers (`GetGatewayDetails`, `GetHTTPRouteDetails`,
  `GetGRPCRouteDetails`, `GetTLSRouteDetails`, `GetGatewayClassDetails`,
  `GetListenerSetDetails`, `GetReferenceGrantDetails`,
  `GetBackendTLSPolicyDetails`). No `List*` declarations are expected in
  v1 (per Task 26 Step 3).

- [ ] **Step 3-5:** Add the eight payload-shape entries to
  `ObjectDetailsSnapshotPayload`. Register the eight new tab types in
  `detailsTabTypes.ts`.

- [ ] **Step 6: Pause for commit.** Per Conventions, the agent does NOT run the commit. Report task complete. Suggested user-run message: `feat(frontend): object-details refresh payload variants for Gateway API`

---

### Task 32: Frontend Cluster Config — `GatewayClass`

**Files:**
- Modify: `frontend/src/modules/cluster/contexts/ClusterResourcesContext.tsx`
- Modify: `frontend/src/modules/cluster/components/ClusterResourcesManager.tsx`
- Modify: `frontend/src/modules/cluster/components/ClusterResourcesManager.test.tsx`

- [ ] **Step 1: Write failing test** — assert `GatewayClass` is in the
  `kinds` array passed to the manager.

- [ ] **Step 2-4:** Add `configGatewayClassPermission =
  useUserPermission('GatewayClass', ...)`. Include in the kinds list and
  permission gate. Mirror the `IngressClass` lines verbatim.

- [ ] **Step 5: Pause for commit.** Per Conventions, the agent does NOT run the commit. Report task complete. Suggested user-run message: `feat(frontend): GatewayClass row in Cluster Config`

---

### Task 33: Frontend `StatusPill` component

**Files:**
- Create: `frontend/src/shared/components/StatusPill.tsx`
- Create: `frontend/src/shared/components/StatusPill.css`
- Create: `frontend/src/shared/components/StatusPill.test.tsx`

- [ ] **Step 1: Write failing tests** — table-driven over the four states
  (True/False/Unknown/missing-condition); assert label is the Reason; assert
  the Message renders inside the tooltip; assert pills have the correct CSS
  class for each state. Render in both Light and Dark theme via the theme
  provider.

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement.**

  ```tsx
  // StatusPill.tsx
  import './StatusPill.css';
  import { Tooltip } from '@shared/components/Tooltip'; // or repo's existing tooltip

  export interface StatusPillProps {
      condition: { status: 'True' | 'False' | 'Unknown'; reason?: string; message?: string } | undefined;
      label: string; // e.g. "Programmed"
  }

  export const StatusPill: React.FC<StatusPillProps> = ({ condition, label }) => {
      const state = condition?.status ?? 'Unknown';
      const reason = condition?.reason ?? '—';
      const cls = `status-pill status-pill--${state.toLowerCase()}`;
      return (
          <Tooltip content={condition?.message ?? ''}>
              <span className={cls} aria-label={`${label}: ${reason}`}>
                  {label}: {reason}
              </span>
          </Tooltip>
      );
  };
  ```

  CSS uses theme tokens (see `frontend/src/styles`):

  ```css
  .status-pill { padding: 2px 8px; border-radius: 9999px; font-size: 12px; }
  .status-pill--true    { background: var(--color-success-bg);  color: var(--color-success-fg); }
  .status-pill--false   { background: var(--color-danger-bg);   color: var(--color-danger-fg); }
  .status-pill--unknown { background: var(--color-neutral-bg);  color: var(--color-neutral-fg); }
  ```

- [ ] **Steps 4-5:** Run all tests; expect PASS. Then **pause for commit** (agent does not run it). Suggested message: `feat(frontend): add StatusPill primitive`

---

### Task 34: Extend `ObjectPanelLink` for `ObjectRef` / `RefOrDisplay`

**Files:**
- Modify: `frontend/src/shared/components/ObjectPanelLink.tsx`
- Modify: `frontend/src/shared/components/ObjectPanelLink.test.tsx`

- [ ] **Step 1: Write failing tests:**
  - `ObjectRef` overload: click invokes `openWithObject` with the matching
    reference.
  - `RefOrDisplay` with `Ref` populated: same behavior.
  - `RefOrDisplay` with `Display` populated: renders as plain text (no
    button), tooltip text matches "API version for {Group}/{Kind} is not
    discoverable on this cluster".
  - Disabled case (cross-namespace not visible): renders disabled with
    tooltip "Object not accessible in current view."

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement.** **Important:** `ref` is reserved by React and
  cannot be used as a normal prop name — passing it would attach as a React
  ref forwarder, not a data prop. Use `objectRef` (matches the existing
  pattern documented at the top of `ObjectPanelLink.tsx`). Read the current
  `ObjectPanelLinkProps`, then add a discriminated overload:

  ```ts
  type ObjectPanelLinkProps =
    | { objectRef: ObjectRef; children?: React.ReactNode }
    | { refOrDisplay: RefOrDisplay; children?: React.ReactNode }
    | /* legacy props preserved verbatim from the existing component */;
  ```

  Internal logic — destructure `refOrDisplay` out of props explicitly so
  the spread on the recursive call only carries the *other* props
  (children, className, etc.):

  ```tsx
  if ('refOrDisplay' in props) {
      const { refOrDisplay, ...rest } = props;
      if (refOrDisplay.display) {
          return (
              <Tooltip content={`API version for ${refOrDisplay.display.group || 'core'}/${refOrDisplay.display.kind} is not discoverable on this cluster`}>
                  <span className="object-link object-link--unresolved">
                      {refOrDisplay.display.namespace
                          ? `${refOrDisplay.display.namespace}/${refOrDisplay.display.name}`
                          : refOrDisplay.display.name}
                  </span>
              </Tooltip>
          );
      }
      // refOrDisplay.ref is guaranteed non-nil by the RefOrDisplay invariant.
      return <ObjectPanelLink objectRef={refOrDisplay.ref!} {...rest} />;
  }
  ```

  Detail-tab call sites (Tasks 35-42) use `objectRef={…}` (or
  `refOrDisplay={…}`) — never `ref={…}`.

- [ ] **Steps 4-5:** Run all tests; expect PASS. Then **pause for commit** (agent does not run it). Suggested message: `feat(frontend): ObjectPanelLink accepts ObjectRef / RefOrDisplay`

---

### Tasks 35-42: Per-kind detail tabs

For each kind, one task with the following template. Run them in this order:
**35**: Gateway, **36**: HTTPRoute, **37**: GRPCRoute, **38**: TLSRoute,
**39**: GatewayClass, **40**: ListenerSet, **41**: ReferenceGrant,
**42**: BackendTLSPolicy.

**Files (per task):**
- Create: `frontend/src/modules/object-panel/components/ObjectPanel/Details/<Kind>DetailsTab.tsx`
- Create: same path with `.test.tsx`
- Create: same path with `.stories.tsx`

- [ ] **Step 1: Write failing tests.** Render the tab with mock typed payload
  covering: minimal data (no listeners/rules); fully-populated data; pills
  in each state (True/False/Unknown); refs that resolve (`Ref` branch) and
  that don't (`Display` branch); empty optional collections render their
  empty-state component, not a crash. Mock the data layer per
  `frontend/AGENTS.md` — never the rendering.

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement.** Each tab follows the structural pattern of
  `IngressDetailsTab.tsx` (header + Details summary + kind-specific
  sections). Per-kind content per the design doc Section 3.4:

  - **GatewayDetailsTab** — `GatewayClassRef` as `ObjectPanelLink`, address
    chips, two `StatusPill`s (Programmed, Accepted), Listeners section
    (one row per listener: name/port/protocol/hostname + collapsed-by-
    default per-listener pills, expandable on click).
  - **HTTPRouteDetailsTab / GRPCRouteDetailsTab / TLSRouteDetailsTab** —
    Hostnames chip list, ParentRefs chips (each an `ObjectPanelLink` with
    `RefOrDisplay`), ParentStatuses table (one row per parent, two pills
    Accepted+ResolvedRefs), Rules list (each rule shows match summary text
    + BackendRefs as `ObjectPanelLink`s).
  - **GatewayClassDetailsTab** — Controller, Description, one pill
    (Accepted — sourced from `status.conditions[Accepted]`),
    SupportedFeatures rendered as a chip list (sourced from
    `status.supportedFeatures`, **not** a condition), UsedBy chip list
    (`Gateway` `ObjectPanelLink`s).
  - **ListenerSetDetailsTab** — ParentRef as `ObjectPanelLink`, Listeners
    block (reuse `GatewayDetailsTab`'s listener renderer; extract into a
    shared local component within this file or a sibling file used by both
    tabs), `ConditionsSummary` pills.
  - **ReferenceGrantDetailsTab** — two columns: From (group/kind/namespace
    plain text) and To (group/kind, with `ObjectPanelLink` over `Target`
    when present).
  - **BackendTLSPolicyDetailsTab** — TargetRefs chips
    (`ObjectPanelLink`s), Validation block (CACertificateRefs as
    `ObjectPanelLink`s, Hostname text, WellKnownCACerts text),
    AncestorStatuses rows (two pills each, same renderer as Routes'
    ParentStatuses).

- [ ] **Step 4: Add Storybook story.** Mount through real ObjectPanel chrome
  with mocked refresh-store payload — real components, real CSS only.

- [ ] **Step 5: Run** — expect PASS.

- [ ] **Step 6: Pause for commit.** Per Conventions, the agent does NOT run the commit. Report task complete. Suggested user-run message: `feat(frontend): <Kind>DetailsTab`

---

### Task 43: Verify `NsViewNetwork` rows + filter

**Files:**
- Modify: `frontend/src/modules/namespace/components/NsViewNetwork.test.tsx`
- Modify: `frontend/src/modules/namespace/hooks/useNamespaceFilterOptions.ts` (if needed)

- [ ] **Step 1: Write failing test** — mock the `namespace-network` snapshot
  payload with rows for each new kind, assert: filter dropdown surfaces all
  seven new kinds; rows render through the existing column factories with
  the backend `details` string in the Details column.

- [ ] **Step 2: Run** — expect FAIL (until the kind-map work in Task 27 is
  in; if the test still fails it indicates a missing wiring step).

- [ ] **Step 3: Patch** any missing propagation in
  `useNamespaceFilterOptions` so that the new kinds participate in filter
  options.

- [ ] **Step 4: Run** — expect PASS.

- [ ] **Step 5: Pause for commit.** Per Conventions, the agent does NOT run the commit. Report task complete. Suggested user-run message: `feat(frontend): namespace-network surfaces Gateway API rows`

---

### Task 44: Storybook coverage sweep

**Files:**
- Verify all eight `*DetailsTab.stories.tsx` files added in Tasks 35-42

- [ ] **Step 1: Run Storybook locally.** `mage storybook` (the target name
  is `storybook`, not `frontend:storybook`; see `magefile.go:64`).
  Visually confirm each tab renders correctly in Light and Dark themes
  for: minimal payload, full payload, all-pills-present payload,
  refs-with-Display-branch payload.

- [ ] **Step 2: Address regressions** if any.

- [ ] **Step 3: Pause for commit if any fixes were made.** Per Conventions, the agent does NOT run the commit.

---

### Task 45: Manual verification + `mage qc:prerelease`

**Files:** None.

- [ ] **Step 1: Apply Helm test chart.** Use the *same* `v1.5.x` patch that
  Task 1 selected for the Go module — keeping the CRDs and the typed client
  on the same patch avoids the version-drift warning path. Set a shell
  variable so Step 3 below uninstalls the matching version:

  ```sh
  GATEWAY_API_VERSION="v1.5.x"   # replace with the same patch picked in Task 1
  kubectl apply --server-side -f "https://github.com/kubernetes-sigs/gateway-api/releases/download/${GATEWAY_API_VERSION}/standard-install.yaml"
  helm upgrade --install eg oci://docker.io/envoyproxy/gateway-helm \
      --version v1.7.2 -n envoy-gateway-system --skip-crds --create-namespace
  helm install demo ./test/gateway-api/helm -n gateway-api-demo --create-namespace
  ```

- [ ] **Step 2: Open the app, point at the demo cluster.**
  - Verify the Namespace Network tab on `gateway-api-demo` shows rows for
    each new kind with sensible Details summaries.
  - Click each row and verify the typed `*DetailsTab` renders with non-empty
    content.
  - Verify status pills reflect Envoy Gateway's actual `Programmed` /
    `Accepted` outcomes (some may show `False` initially while Envoy
    reconciles — that's the point).
  - Verify clickable refs navigate correctly between Gateway↔HTTPRoute↔
    Service.
  - Verify Cluster Config tab shows the `GatewayClass`(es) Envoy Gateway
    installs.

- [ ] **Step 3: Uninstall CRDs and reconnect.** Reuse the same
  `${GATEWAY_API_VERSION}` from Step 1:

  ```sh
  kubectl delete -f "https://github.com/kubernetes-sigs/gateway-api/releases/download/${GATEWAY_API_VERSION}/standard-install.yaml"
  ```

  Reconnect the cluster in the app (or restart). Verify the kinds disappear
  from filters and capabilities show "not installed."

- [ ] **Step 4: Run `mage qc:prerelease`.** Expect clean. Address any
  findings inline.

- [ ] **Step 5: Pause for commit if any qc fixes were made.** Per Conventions, the agent does NOT run the commit.

- [ ] **Step 6: Pause for PR.** Per `AGENTS.md`, the agent does NOT create
  PRs without explicit user direction. Report task complete and suggest the
  user run `gh pr create` with a body referencing the design doc, e.g.:

  ```
  Implements docs/plans/gateway-api-support-design.md.

  - 8 Gateway API v1 kinds with typed details, status pills, clickable refs
  - Discovery-gated; absent CRDs render no rows and no permission-denied entries
  - Single cohesive landing per the rollout decision in the design

  Coverage gaps (per AGENTS.md): version-drift warning is observability-only;
  live mid-session CRD install is documented follow-up.
  ```

---

## Self-review notes

- Spec coverage: each architectural decision (Tasks 1, 17, 19, 23-26),
  status surfacing (Tasks 8-15 builders + 33 + 35-42), discovery gate
  (Tasks 4 + 17 + 19 + handler `ensureKind`), per-kind presence (Task 7
  interface, Tasks 8-15 callers), `RefOrDisplay` (Tasks 2, 6, 34), all eight
  kinds, `BackendTLSPolicy` ancestor status (Task 15 + Task 42), `object-
  details` refresh path (Tasks 23-25, 31), Cluster Config GatewayClass
  (Tasks 22 + 32), single-landing rollout (one feature branch).
- Type consistency: `ensureKind` is consistently named (Task 8 introduces;
  Tasks 9-15 use). `ConditionsSummary` field names (`Programmed`, `Accepted`,
  `ResolvedRefs`) match between Tasks 2, 5, builders, and `StatusPill` props
  (Task 33). `SupportedFeatures` is a separate `[]string` field on
  `GatewayClassDetails` (not a condition) — sourced from
  `status.supportedFeatures`.
- Placeholders: none. Tasks 10/11 reference Task 9 by name but include the
  per-kind code that differs (the per-kind matchers and field names);
  identical handler skeleton is by design (DRY at the runtime level via the
  shared `ensureKind`/list helpers).
