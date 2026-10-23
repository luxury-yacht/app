# Kind Facets: One Generated Per-Kind Table

Temporary plan from the second app-wide design review (finding #3). It replaces
the frontend's hand-written per-kind behavior tables with one table generated
from the backend kind registry.

- **Status:** John approved the plan on 2026-10-23 with every recommended
  answer (Q1–Q12), after [review rounds 1](#review-round-1-2026-10-23),
  [2](#review-round-2-2026-10-23), and [3](#review-round-3-2026-10-23).
  Phases 1–9 are implemented on branch `kind-facets`; see the
  [completion record](#completion-record-2026-10-23). The native app check is
  pending, so this plan stays until it passes.
- **Base:** `main` at `f9ffc9e1` (Real state test harness #403). Line numbers
  are from that commit.
- **Paths:** relative to `frontend/src/` unless they start with `frontend/`,
  `backend/`, `docs/`, or `.agents/`.
- **Evidence:** every row below was read at its cited line on 2026-10-23.
  Three read-only sweeps covered `modules/object-panel`, the other `modules/*`,
  and `core`, `shared`, `ui`, `utils`, `types`, and `main.ts`. Their citations
  were spot-checked; one wrong count (`RESOURCE_CAPABILITIES`) is corrected
  here to 32 entries.
- **Probes:** two scratch TypeScript 7.0.2 files in the session scratchpad
  (outside the repo) proved the drift guard and the synthetic-row typing in
  [TypeScript guard](#typescript-guard).

## Completion record (2026-10-23)

All nine phases are implemented on branch `kind-facets` on top of `f9ffc9e1`:
John's commits `870614fc` (plan) and `904c4d02` (wip), plus the uncommitted
`knip` fix (three files: `shared/kinds/kindFacets.ts`, `utils/kindViewMap.ts`,
`utils/kindViewMap.test.ts`). Mocks: Go tests use fake clientsets; frontend behavior tests run
on the real-state harness (only the backend boundary is faked). The Overview
index test keeps its pre-existing `ActionsMenu`/`GenericOverview` stubs, and
`ObjectPanelContent.test.tsx` keeps its pre-existing tab stubs.

| Criterion | Status | Evidence |
| --- | --- | --- |
| One generated per-kind table from the registry | passed | `backend/internal/genkindfacets`; `TestGeneratedKindFacetsAreCurrent` (`backend/kind_facets_test.go`) |
| Every facet emitted for every kind | passed | `TestRowsCoverEveryRegisteredKindWithEveryFacet` (40 rows, keys checked by reflection) |
| Today's kind decisions kept | passed | `TestRowsKeepTodaysKindDecisions`; tab pins in `useObjectPanelTabs.test.tsx` (ReplicaSet, CronJob, Node, Pod, Event, Helm) |
| Behavior lookup by complete identity, metadata by group and kind | passed | `kindFacets.test.ts` (version guard proven red by mutation) |
| TypeScript drift guards | passed | mutation checks: utilization (TS2741), owned Jobs (TS2741), list-domain views (TS2349 from the `expectTypeOf(...).toBeNever()` type test in `kindViewMap.test.ts`); probes for TS2353/TS1360/TS2322/TS2820 |
| Agreement tests: pods by owner/node, metrics, list domains, log targets, served versions | passed | `backend/refresh/snapshot/kind_facets_agreement_test.go`, `backend/internal/containerlogs/kind_facets_agreement_test.go`, `TestKindFacetVersionsPassTheBackendTargetChecks`; each proven red by mutation |
| Fix: custom resource sharing a kind name gets no built-in tabs, HPA query, or short name | passed | red/green: `useObjectPanelTabs.test.tsx`, `useObjectPanelFeatureSupport.test.tsx`, `Overview/index.test.tsx`, `useBrowseColumns.test.tsx` |
| Fix: lowercase `node`/`service` refs get node and port-forward actions | passed | red/green `objectActionPolicy.test.ts` ("offers node actions whatever the case") |
| Fix: ReplicaSet opened from a Deployment lists its pods | passed | red/green `objectPanelPodsScope.test.ts` (canonical kind) |
| Fix: ReplicaSet navigation goes to Browse | passed | red/green `kindViewMap.test.ts` |
| Logs targets: pods + watch + ownership; fetch and stream share one key | passed | `logspec_test.go`; `TestFetchAndStreamResolveTheSameScopeThroughOneTargetTable` (red by key mutation); `TestCronJobScopeFollowsPodsOfAFutureJob` and the resolver regressions unchanged |
| Node keeps its own logs source | passed | generator pin (`logs: 'node'`); `useObjectPanelTabs.test.tsx` node Logs case |
| Complexity at 12 or lower in changed functions | passed | `npm run complexity` on changed frontend files; `gocognit -over 12` on changed Go files (the touched `confirmation` memo was 19 before and is now split) |
| Full gate `qc:prerelease` | pending | running |
| Coverage of touched code | pending | |
| Native app check (tabs, Pods list, Logs, Shell, Metrics for Deployment, ReplicaSet, CronJob, Pod, Node, Event) | pending | blocked on John choosing a cluster (AGENTS.md) |

Findings outside this plan (not acted on):

- `NodeDetails.podsList` without `DetailListsPods` (section D, unverified impact).
- `ObjectPanel/constants.ts:8-11` claims panel kinds are always the source's
  case; lowercase links exist (`descriptors/pod.tsx:151`, `workload.tsx:700`).
  The facet lookups now ignore case, so nothing depends on that claim.

## Problem

The backend kind registry is the single source for kinds
([resource-kind-registry.md](../architecture/resource-kind-registry.md)), but
two narrow channels carry per-kind facts to the frontend:

1. `backend/resourcecontract/builtin-resource-identities.json`: identity rows
   plus an `objectMap` flag, derived from the registry by group and kind
   (`backend/resourcecontract/builtin_resources.go:143-152`). It is read by
   `shared/constants/builtinGroupVersions.ts:44-51` and
   `modules/object-panel/objectPanelRef.ts:68-73`. A JSON import has no
   literal types, so TypeScript cannot check anything against it.
2. `shared/actions/objectActions.generated.ts`, written by
   `backend/internal/genobjectactions` (`backend/generate.go:17`). Its
   per-kind part (`kindCapabilities`,
   `backend/internal/genobjectactions/render.go:133-156`) emits only the 9
   kinds that have an action or an alias (`render.go:150`). The frontend looks
   it up by group, version, and alias (`shared/actions/objectActionCapabilities.ts:14-27`).
   The backend `ObjectActions.Aliases` field exists only for that lookup: its
   one consumer is `render.go:139`.

Every other per-kind decision is a hand-written frontend list. The cost:

- **Copies that must agree.** The Pods tab kinds
  (`ObjectPanel/constants.ts:73`) and the pods-scope kinds
  (`ObjectPanel/Pods/objectPanelPodsScope.ts:12-19`, whose comment says it
  mirrors the tab). The metrics kinds (`core/resource-metrics/scope.ts:16-35`)
  and the utilization kinds (`ObjectPanel/Metrics/useUtilizationData.ts:28`),
  although `docs/architecture/resource-metrics.md:67` says "Do not gate it with
  a separate kind list".
- **A frontend action matrix,** which `docs/architecture/permissions.md:116`
  forbids. `RESOURCE_CAPABILITIES` (`ObjectPanel/constants.ts:15-63`) repeats
  the generated restart, scale, trigger, and suspend flags.
- **Kind name without group.** These match the lowercased kind only:
  - tabs (`ObjectPanel/hooks/useObjectPanelTabs.ts:50-53,74`);
  - panel features (`ObjectPanel/hooks/useObjectPanelFeatureSupport.ts:17`);
  - the pods scope (`objectPanelPodsScope.ts:31,45`);
  - the utilization fallback (`useUtilizationData.ts:177`);
  - the log viewer's mode (`ObjectPanel/Logs/LogViewer.tsx:443-445`);
  - Overview's scale and node checks (`ObjectPanel/Details/Overview/index.tsx:72,112`).

  The same panel matches complete identity elsewhere: `MAP_SUPPORTED_GVKS`
  (`objectPanelRef.ts:63-73`) and `isNodeShellTarget`
  (`ObjectPanel/Shell/nodeShell.ts:14-15`).
- **Flags with no effect.** Of `ComputedCapabilities`, only `hasShell`,
  `hasObjPanelLogs`, and `canEditYaml` are read
  (`ObjectPanel/ObjectPanelContent.tsx:252,400,452`; `constants.ts:69,89`).
  `canDelete`, `canRestart`, `canScale`, `canTrigger`, `canSuspend`,
  `hasNodeLogs`, `hasManifest`, and `hasValues` are built at
  `ObjectPanel/hooks/useObjectPanelCapabilities.ts:575-584` and read nowhere
  else (grep of non-test `modules` and `shared`).
- **Navigation drift.** `utils/kindViewMap.ts:22-73` copies each domain's
  kinds by hand (its comment says so at :22-24). It sends `apps/replicaset` to
  the Workloads tab (:30), but `namespace-workloads` lists no ReplicaSets
  (`backend/refresh/snapshot/namespace_workloads.go:130,164-172,484-490`). What
  "go to table" does for a ReplicaSet at runtime is [unverified].
- **New kinds fail silently.** A kind added to the registry also needs rows in
  `RESOURCE_CAPABILITIES` (9 registry kinds are absent today: Event and the
  Gateway API kinds), `utils/kindAliasMap.ts:11-68`, `kindViewMap.ts`, and the
  lists above. Nothing fails when one is missed.

## Target model

### Where a per-kind decision lives

1. **Registry facet, generated.** Any decision about what the app does with a
   kind: tabs, the pods/logs/shell/metrics source, action eligibility, list
   navigation, and the short name. It is declared once in the kind's
   descriptor (or derived from an existing facet) and emitted for every
   registered kind. The frontend looks behavior up by complete identity
   (group, version, kind) and only display names and list navigation by
   group and kind ([Frontend accessor](#frontend-accessor)).
2. **DTO rendering in the frontend, typed.** Code that reads a detail DTO's
   fields: the Overview descriptors (settled; `descriptorRegistry.ts:72-76`)
   and the `DETAIL_DERIVATIONS` accessors. Where a section exists *because of*
   a facet, its accessor table is a mapped type over that facet, so TypeScript
   forces the two to agree.
3. **Presentation with no behavior.** Colors, constant kind columns in
   single-kind tables, and copy. Each one is justified in the inventory.
4. **Data owned by another contract.** Relationship links built from strings,
   permission spec lists, and attention filters. They are out of scope here
   and listed as follow-ups.

### Backend: new descriptor facets

`kindspec.Descriptor` (`backend/kind/kindspec/descriptor.go:95-144`) gains
three facet groups. Zero values mean "generic kind", so a new kind with no
panel facets still gets the generic tabs.

```go
// ObjectPanel declares the object panel's kind-dependent tabs.
type ObjectPanel struct {
	Pods           PanelPods  // None | ByOwner (workload selector) | ByNode (node selector)
	Jobs           bool       // Jobs tab fed by the detail DTO's jobs (CronJob)
	Logs           PanelLogs  // None | Pod | OwnedPods | Node
	Shell          PanelShell // None | Exec | Node
	DebugContainer bool
	HideEvents     bool // Event: no Events tab of its own
	HideYAML       bool // Event: no YAML tab
}

// MetricsSource names the refresh domain whose rows carry the object's usage.
type MetricsSource int // None | Pods | Workloads | Nodes

// Display is how the UI names the kind. Phase 6.
type Display struct {
	ShortName     string   // shown with "short resource names" on
	Label         string   // full-name override; empty means Kind
	SearchAliases []string // extra command-palette tokens (kubectl short names)
}
```

- `Descriptor` gains `Panel ObjectPanel`, `Metrics MetricsSource`,
  `Display Display`, and in Phase 7 `ListDomain`.
- `ObjectPanel.Logs` is declared only until Phase 8. Phase 8 replaces it with
  `Descriptor.Logs *logspec.Target` (container logs, derived) and
  `ObjectPanel.NodeLogs` (Node's separate source).
- `ObjectActions` gains `NamespaceFinalizer` (Namespace).
  `ObjectActions.Aliases` is deleted, since GroupKind lookup ignores case.
- `kindspec` cannot import `refresh/snapshot`: the registry imports the kind
  packages, and snapshot imports the registry. So `MetricsSource` is an enum.
  The generator maps it to domain names, and a snapshot test pins that
  mapping (see [Agreement tests](#agreement-tests)).

Values that differ from zero. Every value preserves today's behavior; the
sources are cited in the inventory.

| Kind | Pods | Jobs | Logs | Shell | Debug | Metrics | Other |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Pod | – | – | Pod | Exec | yes | Pods | |
| Deployment | ByOwner | – | OwnedPods | – | – | Workloads | |
| StatefulSet | ByOwner | – | OwnedPods | – | – | Workloads | |
| DaemonSet | ByOwner | – | OwnedPods | – | – | Workloads | |
| ReplicaSet | ByOwner | – | OwnedPods | – | – | – | |
| Job | ByOwner | – | OwnedPods | – | – | – | |
| CronJob | – | yes | OwnedPods | – | – | – | |
| Node | ByNode | – | Node | Node | – | Nodes | |
| Namespace | | | | | | | `NamespaceFinalizer` |
| Event | | | | | | | `HideEvents`, `HideYAML` |

These facets already exist and are derived, not redeclared:

- `versions`: every version the identity contract lists for the kind's group
  and kind (`BuiltinResources`, `builtin_resources.go:81-140`). That is one
  version for every kind except HorizontalPodAutoscaler (`v1` and `v2`). The
  `objectMap` rule already covers every served version
  (`builtin_resources.go:69-71`); the version agreement test (below) keeps
  capability facets off versions the backend rejects;

- `detailListsPods` from `DetailListsPods`;
- `objectMap` from `Collector != nil`, as `kindregistry.ObjectMapIdentities`
  does (`backend/kind/kindregistry/objectmap.go:8-12`);
- restart, rollback, and scale from the `Workload` funcs, and portForward,
  reconnect, and usesServicePortSpec from `PortForward`, exactly as
  `render.go:136-149` does today;
- trigger, suspend, cordon, and drain from `Actions`;
- `detailType`, the lowercased kind, which is genappbindings' dispatch key
  (`backend/internal/genappbindings/render.go:80-83`).

### Generator

- A new `backend/internal/genkindfacets` package (with `cmd/`) writes
  `frontend/src/shared/kinds/kindFacets.generated.ts`. `backend/generate.go`
  gets one `//go:generate` line beside the object-actions line (:17).
- It takes over `kindCapabilities()` from `genobjectactions/render.go:133-156`.
  `objectActions.generated.ts` keeps the action vocabulary (ids, definitions,
  permission templates, node permissions) and drops `kindCapabilities` and
  `ObjectActionKindCapability`.
- One row per `kindregistry.All` entry (40, pinned by
  `backend/kind/kindregistry/registry_test.go:20`), sorted by kind. Every facet
  key is always written: no `omitempty`, and enums are written as strings with
  an explicit `'none'`.
- The output has two parts. `KindFacetsSchema` is a structural interface:
  strings for identity, and the facet enums as string-literal unions.
  `GENERATED_KIND_FACETS` is a literal written `as const satisfies readonly
  KindFacetsSchema[]`, like `objectActions.generated.ts:6`, so the facet values
  stay literal types.
- The new file joins the generated-file excludes in `frontend/biome.jsonc:30-31,44-45,57-58`
  and `frontend/scripts/check-biome-suppressions.mjs:55`.

Sketch of one generated row:

```ts
{ group: 'apps', versions: ['v1'], kind: 'Deployment', resource: 'deployments',
  namespaced: true, detailType: 'deployment', detailListsPods: true, objectMap: true,
  panel: { pods: 'owner', jobs: false, logs: 'owned-pods', shell: 'none',
           debugContainer: false, eventsTab: true, yamlTab: true },
  metricsDomain: 'namespace-workloads',
  actions: { restart: true, rollback: true, scale: true, portForward: true,
             reconnect: true, usesServicePortSpec: false, trigger: false,
             suspend: false, cordon: false, drain: false,
             removeNamespaceFinalizer: false },
  display: { shortName: 'deploy', label: 'Deployment', searchAliases: [] },
  listDomain: 'namespace-workloads' }
```

### Frontend accessor

`shared/kinds/kindFacets.ts` owns the table and its lookups.

- **Rows.** `SYNTHETIC_KIND_FACETS` holds the HelmRelease row (not in the
  registry), written `as const satisfies readonly KindFacetsSchema[]`.
  `KIND_FACETS = [...GENERATED_KIND_FACETS, ...SYNTHETIC_KIND_FACETS] as const`,
  and `KindFacets = (typeof KIND_FACETS)[number]` keeps every literal,
  HelmRelease's included. A synthetic row cannot `satisfies KindFacets`: its
  group and kind are outside the generated literal union (TS2322, reproduced
  by the reviewer and in the probe).
- **Behavior lookup, complete identity.** `lookupKindFacets({ group, version, kind })`
  needs the exact group, a version in the row's `versions`, and the kind
  ignoring case (today's aliases accept lowercase spellings,
  `objectActionCapabilities.ts:17-27`). Every behavior facet goes through it:
  panel, metrics, actions, and `objectMap`. It matches the backend's own
  checks:
  - workload actions require `apps/v1` (`backend/workload_actions.go:50-62`);
  - log scopes must be one of the typed clients' GVKs
    (`backend/internal/containerlogs/target_identity.go:16-34`, called from
    `ParseTargetScope`, `resolve.go:25,36`);
  - metrics reject `apps/v1beta1` Deployments
    (`core/resource-metrics/scope.test.ts:35-45`), and the row selector
    matches the version (`selectors.ts:21-26`);
  - today's action lookup keys on group and version
    (`objectActionCapabilities.ts:14-15`).
- **Metadata lookup, group and kind.** `lookupKindMetadata({ group, kind })`
  serves only display names (Phase 6) and list navigation (Phase 7). Neither
  changes what the backend is asked to do. Built-in kinds are unique by group
  and kind; a custom resource that shares a kind name has another group and
  gets neither.
- **Kind-name exception.** `kindNameDisplay(kind)` labels filters whose own
  key is the kind name ([Phase 6](#phase-6-display-names)). The 40 registry
  kind names are distinct, so the name resolves to at most one built-in row.
- **Types.** `KindFacets`, `BuiltinKind`, `KindsWhere<P>`, and
  `DetailTypesWhere<P>` are derived from the combined literal.
  `KindFacetsSchema.detailType` is `ObjectDetailType`, which ties both tables
  to the generated detail union (`core/refresh/types.generated.ts:2292-2338`).
- **HelmRelease.** Its row has no pods, jobs, metrics, Events, or YAML tab,
  short name `helm`, and list domain `namespace-helm`. Its GVK constant moves
  there from `objectPanelRef.ts:58` and `shared/actions/objectActionClient.ts:87-98`.
  Its Manifest and Values tabs stay keyed on the complete-GVK `isHelmRelease`
  check (`objectPanelRef.ts:186-189`): they read a non-Kubernetes source, so
  they are not kind facets. `HELM_HIDDEN_TABS` (`useObjectPanelTabs.ts:42`)
  goes away because the row's facets already hide those tabs.
- `shared/actions/objectActionCapabilities.ts` reads `facets.actions` through
  `lookupKindFacets`; its alias maps (:17-34) go away. `normalizeKind`
  (`shared/actions/objectActionPolicy.ts:16-17`) is kept, derived from the
  table, until Phase 5 removes its callers (`useObjectActionController.tsx:219,731`;
  `Overview/index.tsx:72,112`).

### TypeScript guard

The probe modeled the generated table and `ObjectDetailTypes`, then typed
accessor tables like this:

```ts
type DetailTypesWhere<P> = Extract<KindFacets, P>['detailType'];
const ACTIVE_POD_NAMES: {
  [K in DetailTypesWhere<{ detailListsPods: true }>]: (d: ObjectDetailTypes[K]) => string[] | null;
} = { deployment: …, replicaset: …, cronjob: … };
```

Results under `tsc --strict`:

- the matching table compiles;
- a facet turned on without an accessor fails (TS2741);
- a facet turned off with a leftover accessor fails (TS2353);
- a generated `detailType` that is not a real detail type fails (TS1360).

The second probe added the schema and the synthetic row:

- `[...GENERATED, ...SYNTHETIC] as const` keeps HelmRelease's literals in
  `KindFacets`, and the mapped guards still apply;
- a synthetic row checked against the generated union fails (TS2322), which
  is why the schema exists;
- a synthetic row with a bad facet value fails the schema (TS2820);
- a synthetic row that turns on a facet without its accessor fails (TS2741).

This is the same exhaustive mapped-type pattern as the settled Overview
registry (`descriptorRegistry.ts:72-76`).

### Agreement tests

Declared facets that restate a backend producer get a test at that producer,
so a declared value cannot drift from what the backend serves:

- **Pods by owner:** for each `ByOwner` kind, a pod owned through that kind's
  real owner chain is returned by `filterPodRowsByScope` with a workload
  selector (`backend/refresh/snapshot/pods.go:386-433`). Deployment pods match
  through the resolved owner and ReplicaSet pods through the direct owner
  (:417-424).
- **Logs:** `containerlogs.ValidateTargetGVK` accepts exactly the GVKs of the
  `Pod` and `OwnedPods` rows (`target_identity.go:16-34`), and `Resolve`
  handles each of them (`resolve.go:88-103`). The `Node` row is the only
  `'node'` row, and it is cluster-scoped, which container-log scopes reject
  (`resolve.go:33-35`). Its logs come from the node-log service
  (`backend/node_logs.go:15-35`).
- **Versions:** each listed version of a row passes the backend check for
  each of its facets: the action validators (for example
  `validateAppsV1WorkloadAction`, `workload_actions.go:50-62`),
  `ValidateTargetGVK` for logs, and the pods owner match, which compares the
  complete GVK (`pods.go:426-433`). Today only HorizontalPodAutoscaler lists
  two versions, and it has none of these facets. The test makes it fail to
  add a version to a capability row before its backend accepts it.
- **OwnedPods needs pod names:** every `OwnedPods` kind has `DetailListsPods`,
  because the log viewer reads `activePodNames` from the detail
  (`ObjectPanelContent.tsx:201`; `objectDetailModel.ts:134-135`).
- **Metrics:** the generator's enum-to-domain mapping names real domains, and
  each `Workloads` kind is a `namespace-workloads` source kind
  (`namespace_workloads.go:164-172`).

## Inventory

### A. Moves to a new facet

| Where | Decision today | Facet |
| --- | --- | --- |
| `ObjectPanel/constants.ts:70-74` `PODS.onlyForKinds` | Pods tab for node, deployment, daemonset, statefulset, job, replicaset | `panel.pods !== 'none'` |
| `ObjectPanel/constants.ts:75-79` `JOBS.onlyForKinds` | Jobs tab for cronjob | `panel.jobs` |
| `ObjectPanel/constants.ts:86-91` `SHELL.onlyForKinds` | Shell tab for pod, node | `panel.shell !== 'none'` |
| `ObjectPanel/constants.ts:15-63` `objPanelLogs`, `nodeLogs`, `shell`, `debug` | Logs, node logs, shell, debug per lowercase kind | `panel.logs`, `panel.shell`, `panel.debugContainer` |
| `useObjectPanelFeatureSupport.ts:17-31` | Looks those flags up by lowercase kind | Same facets, by group and kind |
| `useObjectPanelTabs.ts:42,44-53,74` | Helm and Event tab hiding; `onlyForKinds` match | `panel.eventsTab`, `panel.yamlTab`; HelmRelease synthetic row (`HELM_ONLY_TABS` at :43 stays on `isHelmRelease`) |
| `objectPanelRef.ts:183,264` `isEvent` | Event tab hiding | `panel.eventsTab`, `panel.yamlTab` |
| `Pods/objectPanelPodsScope.ts:13-19,40-45` | Workload or node pods selector | `panel.pods` (`'owner'` → workload, `'node'` → node) |
| `modules/namespace/components/podSelectionFacets.ts:29-30,52` | Node parent filters by the nodes facet, others by owners | `panel.pods === 'node'` |
| `useObjectPanelCapabilities.ts:186-195` | Logs permission: the named pod, or Pod-level for workloads | `panel.logs` (`'pod'` vs `'owned-pods'`) |
| `useObjectPanelCapabilities.ts:376,567-571` | Node log discovery; node vs container Logs tab | `panel.logs === 'node'` |
| `useObjectPanelCapabilities.ts:253`, `Shell/ShellTab.tsx:722,1255` | Node shell vs pod exec | `panel.shell` |
| `useObjectPanelCapabilities.ts:290-300` | Debug-container permission when supported | `panel.debugContainer` |
| `ObjectPanelContent.tsx:190,199` | Node log viewer vs container log viewer; `'pod'` default | `panel.logs` |
| `Logs/LogViewer.tsx:443-445` | Single-pod vs owned-pods mode; previous logs for pods only | `panel.logs` passed in, not a kind string |
| `core/resource-metrics/scope.ts:16-35` | Metrics domain: node → nodes, pod → pods, three workloads → namespace-workloads | `metricsDomain` |
| `Metrics/useUtilizationData.ts:28,177` | Detail fallback kinds | `metricsDomain !== 'none'` |
| `utils/kindAliasMap.ts:11-68,72-75`, read by `getDisplayKind` (:84) at 19 call sites | 41 short names, 2 label overrides, looked up by kind name only | `display.shortName`, `display.label` via `lookupKindMetadata`; the call-site migration is in [Phase 6](#phase-6-display-names) |
| `utils/kindAliasMap.ts:98-171` | Command-palette tokens: aliases, lowercase kinds, plural guesses, 49 kubectl aliases (:112) | `display.searchAliases`, plus `resource` for plurals; still a kind-name search (`CommandPalette.tsx:80-92`) |
| `utils/kindViewMap.ts:25-73,87` | 41 kind → view rows | `listDomain`, plus a domain → view field in `core/navigation/viewRegistry.ts` |
| `useObjectPanelCapabilities.ts:168` | Namespace finalizer capability (complete GVK already) | `actions.removeNamespaceFinalizer` |

### B. Already generated; switch the call site

| Where | Decision today | Use |
| --- | --- | --- |
| `ObjectPanel/constants.ts:18-23` `restart`, `scale`, `trigger`, `suspend` | Duplicate the action matrix | Delete (see E); actions read `facets.actions` |
| `shared/hooks/useObjectActions.tsx:207` | Trigger/suspend items only when kind is `'CronJob'` | `capability.trigger` / `capability.suspend` |
| `shared/hooks/useObjectActionController.tsx:197` | Cordon/drain permissions only for `'Node'` | `capability.cordon \|\| capability.drain`, as :268-271 already does |
| `shared/hooks/useObjectActionController.tsx:236` | Trigger/suspend permissions only for `'CronJob'` | `capability.trigger` / `capability.suspend` |
| `shared/hooks/useObjectActionController.tsx:730-731` | Undrained-node warning on delete | `capability.drain` plus `unschedulable` |
| `Details/Overview/index.tsx:72` | HPA query when `SCALABLE_KINDS` has the kind name | `facets.actions.scale`, by group and kind |
| `Details/Overview/index.tsx:112` | Node maintenance wiring when kind is `'Node'` | `facets.actions.cordon \|\| drain` |
| `shared/hooks/useNodeMaintenanceActions.tsx:168-181` | Hand-built Node and Pod permission keys | Generated `NODE_ACTION_PERMISSIONS` (`objectActions.generated.ts:59`) |
| `Details/objectDetailModel.ts:151-176` (gated sections) | `activePodNames`, `desiredScaleReplicas`, `portForwardAvailable`, `cronJobSuspended` per detail type | Mapped types over `detailListsPods`, `actions.scale`, `actions.portForward`, `actions.suspend` |
| `ObjectPanelContent.tsx:316` | Jobs rows only from `detailType === 'cronjob'` | Mapped type over `panel.jobs` |
| `Metrics/useUtilizationData.ts:153-164` | Utilization per detail type | Mapped type over `metricsDomain` |

Typing the gated sections changes one value. ReplicaSet gets
`portForwardAvailable` today through the shared `scalableWorkload` entry
(`objectDetailModel.ts:151-156,168`), but ReplicaSet has no port-forward facet.
The policy checks the capability first (`shared/actions/objectActionPolicy.ts:132`),
so the value is never read [verify with the Phase 4 test].

### C. Frontend presentation that stays

| Where | Why it stays |
| --- | --- |
| `Details/Overview/descriptorRegistry.ts:72-118` and `descriptors/*.tsx` | Settled: each renders its own DTO. Internal kind branches pick copy or layout for that DTO: `workload.tsx:446` strategy tooltip, `gateway.tsx:319,340` route kinds sharing `RouteDetails`, `rbac.tsx` subject kinds, `PrometheusSections.tsx:168`, `karpenter.tsx:136-142` CRD layouts |
| `objectDetailModel.ts` ungated sections: `containerSection`, `availableContainers`, `dataSection`, `roleRules`, `namespaceFinalization` | They read DTO fields for rendering; component-structure.md requires them per detail type, never inferred from field names. Still optional per type |
| `shared/utils/kindBadgeColors.ts:25-33` | Color slot overrides (7 entries) |
| `EventsGridView.tsx:120-122`, `ClusterViewNodes.tsx:171-172`, `NsViewPods.tsx:177`, `NsViewHelm.tsx:97-98` | Constant kind column in a single-kind table: the kind is the data |
| `NsViewWorkloads.tsx:240-241` | Row class for standalone pods |
| `shared/hooks/useObjectActions.tsx:134,157,177` | An Event row that carries an involved object gets "View Object" and no Diff (the menu acts on the referent; an Event without one keeps Diff, :133-135). "Go to Namespace" for a Namespace. The kind is the data, which the registry's sanctioned exceptions allow. Tighten the name match to group and kind |
| `core/telemetry/sentry.ts:194-197` | Redacts `<kind> <name>` in free text; not dispatch |
| `modules/object-map/objectMapCollapse.ts:18-26,102,146,163` | Object-map presentation, frontend-only by design (:18-20). Kind-only matching is a follow-up (D) |
| `ClusterOverview.tsx:306-312`, `clusterOverviewModel.ts:306-309` | Cards for fields of the overview payload |
| `ClusterViewIdentities.tsx:59`, `modules/object-panel/panelTarget.ts:8,25,46` | RBAC subject kinds (User, Group), not resources |

### D. Another contract's data (non-goal here; follow-ups)

- **Relationship links built from strings, without full identity:**
  - `ClusterViewStorage.tsx:52-73` (PV → PVC, PV → StorageClass);
  - `NsViewStorage.tsx:48-56` (PVC → StorageClass);
  - `NsViewPods.tsx:150-157,228-236` (Pod → Node);
  - `modules/browse/hooks/customCatalogRowAdapter.ts:96-99,127` (CR → CRD, with
    the CRD name derived in the frontend);
  - `descriptors/rbac.tsx:156-158` (roleRef namespace by kind);
  - `ResourceHeader.tsx:38-40` (Namespace).

  These belong to the `ResourceLink` contract in
  [shared-resource-model.md](../architecture/shared-resource-model.md): rows
  should carry links.
- **Permission spec lists:** `core/capabilities/permissionSpecs.ts` (115
  rows), and the per-view gating by one representative kind in
  `ClusterResourcesManager.tsx:28-85`. These belong to
  [permissions.md](../architecture/permissions.md). The `nodeActions` block
  (:195-204) overlaps `NODE_ACTION_PERMISSIONS`.
- **Attention filters:** `GlobalViewNamespaces.tsx:35-38` copies the backend
  unhealthy rollup (`backend/refresh/snapshot/namespaces.go:802-806`), and
  `useClusterOverviewNavigation.ts:11-17` copies finding IDs. The namespace
  row and the overview payload should carry their filter.
- **Row semantics:** `NsViewAutoscaling.tsx:153-158` applies the HPA default
  `min ?? 1` on the frontend. `podSelectionFacets.ts:19` re-encodes the
  backend's pod facet value (`pods.go:108,131`); the row should carry it.
- **Object map:** kind-only checks in `objectMapCollapse.ts`, and the edge
  table `objectMapEdgeStyle.ts:32-47` that mirrors the backend.
- **Custom-resource families** (ArgoCD, cert-manager, Karpenter, External
  Secrets, Prometheus) resolve by backend family facts, not the registry.
  `karpenterColumns.tsx:21` matches `NodePool` without its group.
- **Backend:** `NodeDetails` carries `podsList`
  (`backend/resources/nodes/dto.go:52`), but the Node descriptor has no
  `DetailListsPods`, so pod changes may not evict cached Node details
  (`backend/response_cache_invalidation.go:26`). Impact [unverified];
  investigate separately.

### E. Dead or vestigial; remove with the phase that replaces them

- `RESOURCE_CAPABILITIES.delete`, `.restart`, `.scale`, `.trigger`, and
  `.suspend` (`constants.ts:15-63`), with `FeatureSupport.delete`, `.restart`,
  `.scale`, `.trigger`, `.suspend`, and `.edit`
  (`useObjectPanelFeatureSupport.ts:24-31`).
  - Their only effect is the permission descriptors registered at
    `useObjectPanelCapabilities.ts:145-159`. Those feed `canDelete` and the
    other unread fields.
  - Before deleting, trace whether anything relies on those queries filling
    the shared permission store. Batch E of the harness migration found the
    object map's menu relies on permissions "queried by something else
    first". `ObjectPanel.tsx:152` also queries the namespace's permissions.
- The unread `ComputedCapabilities` fields (`types.ts:49-58`, built at
  `useObjectPanelCapabilities.ts:575-584`).
- `utils/kindAliasMap.ts:78` `getTypeAlias`, which has no caller outside its
  file.
- `kindspec.ObjectActions.Aliases` and the seven alias lists in
  `backend/resources/{pods,deployment,replicaset,statefulset,daemonset,job,cronjob}/descriptor.go`.
- `objectActionCapabilities.ts:17-34`: the alias and identity maps.
- `utils/kindViewMap.ts:25-73` after Phase 7.

## Intentional differences, kept as explicit facets

None of these is unified. Each keeps today's behavior and is visible in the
generated table:

- **CronJob** lists pods in its detail (`DetailListsPods`) and resolves its
  pods by owner (`backend/resources/pods/streamsummary.go:115-120`), but it
  shows a Jobs tab, not a Pods tab: `panel.pods: 'none'`, `panel.jobs: true`.
- **ReplicaSet** has a Pods tab and owned-pods logs, but no metrics
  (`namespace-workloads` has no ReplicaSet rows) and no port-forward (its
  descriptor has no `PortForward`).
- **Job and CronJob** have no metrics tab. Job rows do carry pod usage
  (`backend/refresh/snapshot/pod_aggregate.go:89-92`, `namespace_workloads.go:419-423`)
  [unverified at runtime]. See Q5.
- **DaemonSet** restarts and rolls back but does not scale (its descriptor has
  no `Scale`).
- **Node** lists pods by node, not owner. Its logs are journal and files, and
  its shell is a debug pod.
- **Event** has no Events, YAML, or Map tab. Map is already `objectMap: false`.
- **Containers section:** Job and CronJob deliberately have none
  (`objectDetailModel.ts:79`). This is DTO presentation (C), unchanged.

## Non-goals

- Changing which tabs or actions any built-in kind has. Q5 lists candidates
  for separate decisions.
- Diff and "View Object" for Event rows: they depend on the row's involved
  object, not on the kind (section C).
- The Overview descriptor registry and its keying by `detailType` (settled).
- Section C presentation and every section D contract.
- Generic Pods/Logs tabs for custom resources. The pods owner selector would
  match any owner GVK (`pods.go:417-433`), but that is a feature question.
- Frontend `permissionSpecs.ts`, the attention payload, and `ResourceLink`
  migrations.
- The settings-schema generation (finding #4).

## Phases

Each phase is a self-contained PR that keeps the gates green. A phase that
changes behavior starts with a failing test; a pure refactor first pins today's
behavior with tests that pass before and after. Phases 2–7 depend on Phase 1
and share files (for example `ObjectPanelContent.tsx` in Phases 2 and 4), so
run them in order.

### Phase 1: facets and generator (no behavior change)

- [x] Red: `genkindfacets` render test asserts one row per `kindregistry.All`
  entry, sorted, with every facet key present. Compare each row's JSON keys
  with the facet struct's fields by reflection. Then the drift test
  `TestGeneratedKindFacetsAreCurrent`, beside
  `backend/object_actions_test.go:219-231`.
- [x] Add `ObjectPanel`, `MetricsSource`, and `NamespaceFinalizer`
  to `kindspec`. Set the [values](#backend-new-descriptor-facets) in the
  pods, deployment, statefulset, daemonset, replicaset, job, cronjob, nodes,
  namespaces, and events descriptors.
- [x] Write the generator. Move `kindCapabilities()` into it, remove
  `kindCapabilities` from `genobjectactions`, delete `ObjectActions.Aliases`
  and the alias lists, and add the `go:generate` line and the Biome excludes.
- [x] Add the agreement tests (pods by owner, logs GVKs, versions, owned pods
  need `DetailListsPods`, metrics domain mapping).
- [x] Frontend: `shared/kinds/kindFacets.ts`, with the schema-checked
  synthetic HelmRelease row, the combined literal table, and both lookups.
  Switch `objectActionCapabilities.ts` to `lookupKindFacets`. The existing `objectActionPolicy` and `objectActionContract` tests are
  the regression proof that action availability does not change.

### Phase 2: panel tabs, pods scope, logs, shell

- [x] On the harness (`useObjectPanelTabs.test.tsx` already installs it,
  :19-25, and `ObjectPanel.test.tsx` has a "tab availability" block at :201):
  - red: a custom resource whose kind is `Job` (group `batch.volcano.sh`)
    gets no Pods or Logs tab (Q4);
  - pin: ReplicaSet gets Pods and Logs but no Metrics; CronJob gets Jobs and
    no Pods; the existing per-kind tab cases stay as the regression set.
- [x] Replace `onlyForKinds`, `useObjectPanelFeatureSupport`, `isEvent`, and
  `HELM_HIDDEN_TABS` with facet predicates. Replace `WORKLOAD_SCOPE_KINDS` and the
  node check in `objectPanelPodsScope.ts` and `podSelectionFacets.ts`.
- [x] Switch the logs and shell branches (`ObjectPanelContent.tsx:190,199`,
  `LogViewer.tsx:443-445`, `useObjectPanelCapabilities.ts:186-195,253,376,567-571`,
  `ShellTab.tsx:722,1255`) to `panel.logs` and `panel.shell`.
- [x] Trace the permission-query side effect, then delete section E's panel
  flags and the unread `ComputedCapabilities` fields. If the trace finds a
  reader, keep the query and give it an owner instead.

### Phase 3: metrics

- [x] Pin (refactor): a harness test shows no Metrics tab for a custom
  resource named `Deployment` (already true through the GV check at
  `scope.ts:12-15`), and the tab for each `metricsDomain` kind. The
  unsupported-version case (`scope.test.ts:35-45`) keeps passing through
  `versions`.
- [x] `resolveResourceMetricsScope` reads `metricsDomain`. Delete
  `UTILIZATION_KINDS` and type `detailUtilization` over `metricsDomain`.
- [x] Update `resource-metrics.md:35-36,63-67`.

### Phase 4: detail derivations

- [x] Split `DETAIL_DERIVATIONS` into the four gated accessor tables
  ([B](#b-already-generated-switch-the-call-site)) and the ungated sections.
  The Jobs rows accessor becomes a `panel.jobs` mapped type.
- [x] Red first: `objectDetailModel.test.ts` adds "ReplicaSet reports no port
  forward" (a model change with no visible effect, per section B).
  `objectDetailModel.test.ts:71` covers the forwardable kinds.
- [x] Update `docs/frontend/component-structure.md:127-134`.

### Phase 5: remaining action call sites

- [x] Section B rows in `useObjectActions.tsx`,
  `useObjectActionController.tsx`, `Overview/index.tsx`, and
  `useNodeMaintenanceActions.tsx`, plus `removeNamespaceFinalizer`.
- [x] Red: an Overview test where a custom resource named `Deployment` makes
  no `workload-hpa-managed` query (today `Overview/index.tsx:72` matches the
  name).

### Phase 6: display names

- [x] Red: with short names on, a custom resource named `Deployment` (group
  `example.com`) shows `Deployment` in Browse, not `deploy`. Today
  `useBrowseColumns.tsx:47` passes only `item.ref.kind`. Pin (refactor): the
  command palette resolves `deploy`, `deployments`, and `cj`, and a built-in
  Deployment shows `deploy`.
- [x] Add `Display` to the 40 descriptors (values copied from
  `kindAliasMap.ts:11-75,112-162`), plus the HelmRelease row.
- [x] Replace `getDisplayKind(kind, short)` (`kindAliasMap.ts:84`) with
  `kindDisplayName({ group, kind }, short)` over `lookupKindMetadata`, and
  migrate all 19 call sites:
  - **Holding a ref; pass it** (12):
    - `ui/modals/ObjectDiffModal.tsx:136`;
    - `ui/command-palette/CommandPalette.tsx:218`;
    - `ClusterViewAttention.tsx:114`;
    - `ClusterViewCRDs.tsx:53`;
    - `ClusterViewStorage.tsx:80`;
    - `useWorkloadTableColumns.tsx:93`;
    - `NsViewAutoscaling.tsx:104`;
    - `objectMapG6Data.ts:323`;
    - `objectMapVisibleState.ts:192`;
    - `CustomResourceGridView.tsx:118`;
    - `useBrowseColumns.tsx:47`;
    - `AggregatedResourceGridView.tsx:84`.

    The fallback strings at `ClusterViewCRDs.tsx:53`, `ClusterViewStorage.tsx:80`,
    `NsViewAutoscaling.tsx:105`, and `CustomResourceGridView.tsx:120` become a
    full-name fallback.
  - **A constant built-in kind; pass its group and kind** (4):
    `EventsGridView.tsx:122`, `EventsTab.tsx:258`, `ClusterViewNodes.tsx:172`,
    and `NsViewHelm.tsx:98` (the synthetic row).
  - **Needs its group carried** (1): `objectMapG6Tooltip.ts:187`. Its
    node-hover caller has the ref (:119), but the edge-hover callers pass bare
    kinds (:145,150). `ObjectMapHoverEdge.sourceKind`/`targetKind`
    (`objectMapRendererTypes.ts:15-18`, set at
    `objectMapG6EventBindings.ts:103-106`) gain the endpoint's group.
  - **Kind-name filters; presentation exception** (2):
    `ObjectDiffModal.tsx:284-291` and `objectMapVisibleState.ts:95-103`. Their
    option value is the kind name: the diff modal keys options by lowercased
    name (:291) from catalog kinds it maps to names (:339), and the object map
    filters on `node.ref.kind` (`objectMapKindFilter.ts:140`). They label
    through `kindNameDisplay(kind)`, which keeps today's output. Making these
    filters identity-aware would change filtering, which is out of scope.
- [x] `kindAliasMap.ts` keeps only the command-palette token map, built from
  the table. The palette's kind-name search stays a name match
  (`CommandPalette.tsx:80-92`). `getTypeAlias` is deleted.

### Phase 7: list navigation

- [x] Red: "go to table" for a ReplicaSet does not land on the Workloads tab.
  Pin today's runtime first; the expected destination is Browse, since no
  domain lists ReplicaSets (Q9).
- [x] `ListDomain` comes from `Stream.Domain` where present (for example
  `backend/resources/configmap/streamdescriptor.go:24`). It is declared on the
  descriptor for the 12 kinds without a stream descriptor (Pod, Node,
  Service, EndpointSlice, Namespace, Event, Deployment, StatefulSet,
  DaemonSet, Job, CronJob, and ReplicaSet with none).
  - Agreement test: each declared domain's query capabilities list the kind
    (for example `namespace_network.go:71-77`).
- [x] Each view in `core/navigation/viewRegistry.ts` declares the domain it
  renders. `getViewForKind` maps `listDomain` to a view, and
  `BUILTIN_KIND_VIEWS` is deleted.

### Phase 8 (Q8): logs targets on the descriptor

Container-log support is now stated in two backend tables: the GVK allowlist
(`target_identity.go:16-34`) and the resolver switch (`resolve.go:88-103`,
with `getWorkloadSelector` at :136-166). This phase replaces both with a
registry facet, so the container-log values of `panel.logs` are derived.

**What a resolver must return.** Today `Resolve` returns a `Resolution`: the
pods now, and a `PodWatch` that keeps that set current (`resolve.go:46-79`).
The stream relies on both parts:

- its informer lists and watches with the watch's namespace and selectors
  (`refresh/containerlogsstream/streamer.go:538-543`);
- it admits a watched pod only when `Owns` accepts it
  (`streamer.go:617,627-633`).

`Owns` carries two rules. A single pod is matched by name, as a backstop to
the field selector (`resolve.go:71-74`). A CronJob watches every Job pod in
its namespace (`jobNameLabel`), then attributes each pod through its Job's
owner, with a per-session cache (`resolve.go:194-200,242-265`), because future
Jobs get new names. A pod list alone cannot carry either rule, so the
descriptor resolver returns pods *and* a watch.

**Where the types live.** The descriptor vocabulary must not depend on a
consuming subsystem (`resource-kind-registry.md:21-24`), and `containerlogs`
imports `refresh`. Its dependencies are `refresh`, `internal/config`, and
logging/error leaves (`go list -deps`); the `refresh` root imports only
`applog`, `config`, and `errorstatus`. So the contract is a new leaf,
`backend/kind/logspec`, beside `streamspec` and `objectmapspec`
(`resource-kind-registry.md:43-47`). It imports only `context`, `corev1`, and
`client-go`:

```go
// Target is a kind's container-log target: how to find its pods now, and how
// to keep that set current.
type Target struct {
	// SinglePod: the target is one pod, watched by name; previous logs apply.
	SinglePod bool
	// Resolve returns the target's pods and its watch. matchPod lets a
	// single-pod target skip its Get when the selection excludes it, as
	// resolvePod does today (resolve.go:107-120). Each call returns a fresh
	// Watch: Owns may hold per-session state (resolve.go:242-243).
	Resolve func(ctx context.Context, client kubernetes.Interface, namespace, name string,
		matchPod func(name string) bool) (Resolution, error)
}

type Resolution struct {
	Pods  []*corev1.Pod
	Watch Watch
}

// Watch is the namespaced pod watch that keeps a target's pods current.
type Watch struct {
	Namespace, LabelSelector, FieldSelector string
	// Owns attributes a watched pod the selectors cannot (a single pod by
	// name, a CronJob's future Jobs). Nil means every selected pod is owned.
	Owns func(ctx context.Context, pod *corev1.Pod) (bool, error)
}
```

- **The import graph.** `kindspec` gains `Logs *logspec.Target`.
  `containerlogs` imports `logspec` (a leaf, so no cycle). It keeps its
  public `Resolution`/`PodWatch` shape for the stream by wrapping
  `logspec.Watch`: `PodWatch.Owns` calls the predicate, and nil means owned
  (`resolve.go:67-70`). Selection filtering (`filterPodsBySelection`) stays in
  `containerlogs` and runs on every resolver's pods.
- **Kind packages implement `Resolve`.** Pod, Deployment, ReplicaSet,
  DaemonSet, StatefulSet, Job, and CronJob each do. They reuse helpers that
  `containerlogs` exports: listing by selector, the `job-name` label, and the
  CronJob ownership cache with its size cap
  (`config.ContainerLogsStreamCronCacheMaxSize`, `resolve.go:259`).
  `resources/pods` already imports `containerlogs`.
- **One table, one key.** Fetch and stream spell the kind differently today:
  - `ParseTargetScope` keeps `Deployment` (`resolve_test.go:70-73`);
  - the stream's `parseRequest` lowercases it (`handler.go:589`, pinned by
    `handler_test.go:90`), and `Options.target()` passes the lowercase kind
    on (`types.go:36-42`).

  The current checks accept both spellings because both lowercase the kind
  (`target_identity.go:18`, `resolve.go:88`). A raw
  `map[schema.GroupVersionKind]` would not. So `logspec` exports the table as
  a type, not a map:

  ```go
  // Targets is the container-log target table. Its map is unexported, so
  // every read goes through Lookup and its key.
  type Targets struct{ byKey map[schema.GroupVersionKind]Target }

  // key trims group and version and matches them exactly; it trims and
  // lowercases the kind.
  func key(gvk schema.GroupVersionKind) schema.GroupVersionKind

  func NewTargets(entries map[schema.GroupVersionKind]Target) (Targets, error) // error on a key collision
  func (t Targets) Lookup(gvk schema.GroupVersionKind) (Target, bool)
  ```

  - `kindregistry.LogTargets() (logspec.Targets, error)` builds it. That adds
    no cycle: the registry already depends on `containerlogs` through Pods,
    and neither `containerlogs` nor `logspec` imports the registry.
  - Construction, validation (`ParseTargetScope`), and dispatch (`Resolve`)
    all use the same `key`, through `NewTargets` and `Lookup`. Nothing indexes
    by a raw GVK.
  - The stream's lowercased `Options.Kind` stays as it is: its only consumer
    is `target()` (`types.go:39`), and `Lookup` accepts it.
- **Injection.** The table goes to both consumers as a constructor argument
  (Q11):
  - fetch: `backend/pod_logs.go:29,45,56` builds `pods.NewService(deps)`, and
    `resolveTargetPods` (`resources/pods/logs.go:213-222`) passes the table to
    `ParseTargetScope` and `Resolve`;
  - stream: `refresh/system/streams.go:24` builds
    `containerlogsstream.NewHandlerWithLimits`. The handler validates scopes
    (`handler.go:567`), and the streamer resolves them (`streamer.go:190`) and
    follows with the returned watch.

  Both callers sit above the registry, so they can import it.
- **Behavior.** `ParseTargetScope(scope, targets)` rejects a GVK that
  `targets.Lookup` does not find, as `ValidateTargetGVK` does today. It still
  requires a namespace (`resolve.go:33-35`). `Resolve` dispatches through
  `targets.Lookup`. An empty table is an explicit error, not "no logs".

**Node logs stay a separate source.** Node is cluster-scoped, and
container-log scopes require a namespace (`resolve.go:33-35`). Node logs come
from their own service (`backend/node_logs.go:15-35`;
`resources/nodes/logs.go:96,150`) with their own permission check (`get` on
`nodes/proxy`, `node_logs.go:25-31`). So `panel.logs` is a union of two
sources:

- `ObjectPanel.Logs` (Phase 1's declared enum) is replaced by
  `Descriptor.Logs *logspec.Target` for container logs plus a declared
  `ObjectPanel.NodeLogs bool` (Node).
- The generator writes `panel.logs` as `'node'` when `NodeLogs` is set,
  `'pod'` for a `SinglePod` target, `'owned-pods'` for any other target, and
  `'none'` otherwise.
- It rejects a kind that declares both, so the union stays a single value
  per kind.

Checklist:

- [x] Red first, all against one injected table:
  - fetch and follow work for each target kind;
  - one canonical scope reaches the same pods through both paths. Send
    `cluster-a|team-a:apps/v1:Deployment:api` and a `batch/v1` `CronJob`
    scope through the fetch path (`resolveTargetPods`) and through the stream's
    real request parser (`parseRequest`, `handler.go:565`, entered at
    `handler.go:80`), not hand-built `Options`;
  - `Lookup` accepts `Deployment`, `deployment`, and ` deployment `, and
    rejects `apps/v1beta1` and `batch/v1` Deployments;
  - `NewTargets` rejects two entries that share a key;
  - a GVK missing from the table is rejected by both paths with the same
    error;
  - the generator rejects a descriptor with both `Logs` and `NodeLogs`.
- [x] Keep these regression tests passing unchanged in intent; their setup may
  move to the injected table:
  - `TestCronJobScopeFollowsPodsOfAFutureJob` (`refresh/containerlogsstream/lifecycle_test.go:317`);
  - `TestPodScopeFollowsARecreatedPodWithTheSameName` (:167);
  - `TestPodScopeFollowsANewDebugContainer` (:186);
  - `TestExpiredPodWatchRelistsCreatedAndDeletedPods` (:285);
  - `resolve_test.go`'s resolver cases (`backend/internal/containerlogs/resolve_test.go:80-218`),
    including `TestResolveCronJobBatchesOwnedJobsAndWatchesOwnership` (:141)
    and `TestCronJobOwnershipRetriesAfterATransientLookupFailure` (:183).
- [x] Keep Node's logs mode: the generator test pins the Node row at
  `logs: 'node'`. The harness case "uses the Logs tab for node objects rather
  than a separate node logs tab" (`useObjectPanelTabs.test.tsx:192`) stays.
- [x] Move per-kind resolution into the kind packages, delete
  `ValidateTargetGVK` and the `Resolve` switch, and derive the container-log
  values of `panel.logs` from `Logs`.

### Phase 9: close-out

- [x] Docs:
  - `resource-kind-registry.md`: add the generated frontend table to
    "Registry-driven surfaces" (:15) and the facet rule.
  - `permissions.md:111-116`: the per-kind section moves.
  - `.agents/skills/add-resource/references/frontend-surfaces.md:31-38`: it
    still says to add group/version to `builtinGroupVersions.ts` (generated
    since, :44-51) and to edit `constants.ts` capabilities.
  - `.agents/skills/object-panel/SKILL.md:67-73`.
- [x] Release notes in `docs/release/pending.md`, folded into the existing
  area groups: a user-visible entry only for the custom-resource tab fix (Q4)
  and the ReplicaSet navigation fix (Phase 7), and only if those behaviors
  shipped in a release.
- [ ] Delete this plan after moving durable guidance into the docs above.

## Open questions (recommended answers first; all approved 2026-10-23)

1. **Do panel decisions live on the Go descriptor, or in a frontend table
   typed over the generated kinds?** Recommend the descriptor. Then a kind is
   defined in one place ("Adding or changing a kind edits only
   `resources/<kind>/`", resource-kind-registry.md), and producer-coupled
   facets get agreement tests. The descriptor already carries data only the
   frontend reads (`Actions.Aliases`). The alternative, frontend
   `Record<BuiltinKind, …>` tables, is also compile-checked but needs a
   frontend edit per kind.
2. **A new generated file, or extend `objectActions.generated.ts`?**
   Recommend a new `kindFacets.generated.ts` from a sibling generator that
   takes over `kindCapabilities`. Then there is one per-kind table, and the
   action file keeps only the action vocabulary. The alternative is a second
   `-kinds-out` output from `genobjectactions`, like genappbindings' two
   outputs (`backend/generate.go:8`), under a misleading name.
3. **How are facets looked up?** Recommend two lookups (revised in review
   round 1).
   - Behavior uses complete identity: an exact group, a version listed in the
     row, and the kind ignoring case. The backend enforces versions
     (`workload_actions.go:50-62`, `target_identity.go:16-34`).
   - Display names and list navigation use group and kind.

   HorizontalPodAutoscaler `v1` stays map-supported because the row lists
   both contract versions.
4. **May a custom resource that shares a built-in kind name lose the built-in
   tabs?** Recommend yes, as a fix with red tests and a release note. Today
   the match is on the lowercased name (`useObjectPanelTabs.ts:50-53,74`;
   `useObjectPanelFeatureSupport.ts:17`), so by that code path a
   `batch.volcano.sh` Job gets Pods and Logs tabs (runtime [unverified]). Its
   Pods tab may even list pods, since the owner selector matches any GVK
   (`pods.go:417-433`). Its Logs tab cannot work: `ParseTargetScope` rejects
   any GVK outside the typed clients (`resolve.go:36`,
   `target_identity.go:16-34`), so the tab shows an error. Generic tabs for
   custom resources would be a separate feature.
5. **Keep every current kind decision?** Recommend yes for this effort, with
   follow-ups for John to decide:
   - a Metrics tab for Jobs (rows carry usage);
   - ReplicaSet metrics, which would need a source. The doc reason, "until pod
     rows expose both direct and resolved owner identity"
     (resource-metrics.md:35-36), is stale: rows carry both (`pods.go:417-424`).
     The real gap is that no domain has ReplicaSet rows;
   - whether Event's hidden YAML tab is intended.
6. **Move `objectMap` from the identity JSON into the generated table?**
   Recommend yes. Then there is one per-kind facet table, and the JSON goes
   back to identity only (it also lists catalog-only kinds and HPA v1). The
   flag was added on 2026-10-16 (#393), so this reverses a recent choice;
   keeping it in the JSON is also acceptable.
7. **Short names in the registry (`Display`) or a frontend `Record`?**
   Recommend the registry, for the same reason as Q1. `SearchAliases`
   holds kubectl tokens like `cj` and `np` that the app's short names
   (`cron`, `netpol`) do not cover.
8. **Include Phase 8 (logs targets on the descriptor)?** Recommend yes. It
   produces the container-log values of `panel.logs`, follows the
   port-forward precedent, and replaces two hand-written backend kind tables
   (`target_identity.go:18-26`, `resolve.go:88-103`) with the registry.
   - Its resolver returns pods and a watch (with the ownership predicate), so
     the stream keeps following new pods and future CronJob Jobs.
   - Node logs stay a separate declared source.
   - The boundary is in [Phase 8](#phase-8-q8-logs-targets-on-the-descriptor).

   If Phase 8 is deferred, the Phase 1 agreement test keeps the declared
   facet honest.
9. **Include Phase 7 (navigation)?** Recommend yes. It is a 41-row
   hand-mirrored table with a verified mismatch (ReplicaSet). It can also be
   split into its own PR after Phase 1.
10. **HelmRelease as a frontend synthetic row of the same shape?** Recommend
    yes, checked against `KindFacetsSchema` (not the generated union). Its GVK
    and shared facets then live in one place instead of
    `objectPanelRef.ts:58,80-91`, `objectActionClient.ts:87-98`, and
    `useObjectPanelTabs.ts:42`. Its Manifest and Values tabs stay on the
    complete-GVK `isHelmRelease` check.
11. **How does Phase 8 pass the logs targets?** Recommend explicit constructor
    arguments at the two composition points (`backend/pod_logs.go`,
    `refresh/system/streams.go:24`). The alternative is a field on
    `common.Dependencies`. That is less code, but it is per-cluster state
    carrying a process-wide table.
12. **Kind-name filters in Phase 6: keep them as a presentation exception?**
    Recommend yes for this effort. The object map and diff-modal kind filters
    key on the kind name, so their labels do too. Making them identity-aware
    changes what they filter, so that is a separate decision.

## Validation

- **TypeScript is the drift guard.** Literal facet types plus mapped accessor
  tables fail to compile when facets and accessors disagree (probe above).
  `satisfies` checks `detailType` against the generated detail union.
  Re-prove both directions in-project: back the generated file up to the
  scratchpad, flip one facet, run the typecheck, and restore it. Never use
  `git stash`.
- **Backend:**
  - the render test (every facet emitted for every registered kind);
  - the stale-file test;
  - the agreement tests;
  - `TestRegistryKindCount` (`registry_test.go:19-24`): add the new generator
    to its list of drift guards.
- **Behavior on the real-state harness (#403):**
  - tab availability per kind family, the custom-resource negative cases, and
    the Pods tab lease (`app.servePanel` serves the pods its Pods tab lists,
    `test-utils/appState/harness.tsx:255-268`);
  - metrics tab presence and utilization source;
  - log mode (single pod with previous logs vs owned pods).

  No owner stubs (`frontend/biome-plugins/no-owned-state-mocks.grit`).
- **Gates:**
  - focused Vitest and `go test` per phase;
  - `mise exec -- wails3 task test:backend-coverage` and
    `test:frontend-coverage` (80% target on touched code, or report the gap);
  - complexity at 12 or lower (`npm run complexity --prefix frontend -- <files>`,
    `gocognit -over 12`);
  - `mise exec -- wails3 task qc:prerelease`, then inspect the worktree;
  - `qc:docs` for doc changes.
- **Native:** open a Deployment, ReplicaSet, CronJob, Pod, Node, and Event
  panel in `mise exec -- wails3 dev`, and check the tabs, the Pods list, Logs,
  Shell, and Metrics. Ask John which cluster first.

## Review round 1 (2026-10-23)

Each reviewer finding was checked against the code before the plan changed.

1. **P1, version-agnostic lookup.** Confirmed. Workload actions require
   `apps/v1` (`backend/workload_actions.go:50-62`). Metrics reject
   `apps/v1beta1` (`scope.test.ts:35-45`) and match rows by version
   (`selectors.ts:21-26`). Log scopes must be one of the typed clients' GVKs
   (`target_identity.go:16-34`).
   - Changed: behavior looks up by complete identity against the row's
     `versions`, and only display names and list navigation look up by group
     and kind ([Frontend accessor](#frontend-accessor)).
   - Added: a version agreement test, and Q3 is rewritten.
2. **P2, synthetic row typing.** Confirmed: TS2322 reproduced in the
   scratch probe.
   - Changed: a generated structural `KindFacetsSchema` checks both tables.
     The literal union comes from the combined table; the probe proves the
     guards still hold ([TypeScript guard](#typescript-guard)).
3. **P2, Phase 8 dependency boundary.** Confirmed: registry → Pods →
   `containerlogs`, and `containerlogs` cannot import the registry
   (`target_identity.go:13-15`).
   - Added: neutral types, a descriptor facet, `kindregistry.LogTargets()`,
     and constructor injection at the fetch (`backend/pod_logs.go`) and
     stream (`refresh/system/streams.go:24`) composition points. New Q11.
   - Superseded in [review round 2](#review-round-2-2026-10-23).
4. **P2, Phase 6 identity-aware display.** Confirmed: `getDisplayKind`
   takes only a kind (`kindAliasMap.ts:84`), and Browse drops the group
   (`useBrowseColumns.tsx:47`).
   - Added: all 19 call sites, migrated by kind of input, with two kind-name
     filters kept as a stated presentation exception. New Q12.

## Review round 2 (2026-10-23)

1. **P1, the resolver contract dropped the live watch.** Confirmed.
   - `Resolve` returns pods and a `PodWatch` (`resolve.go:46-79`). The stream's
     informer uses its selectors (`streamer.go:538-543`), and it admits pods
     through `Owns` (`streamer.go:617,627-633`).
   - `Owns` holds the single-pod name rule and the CronJob future-Job rule
     (`resolve.go:71-77,193-200,242-265`).
   - Changed: the descriptor resolver returns pods and a watch with its
     ownership predicate. The types sit in a new leaf, `backend/kind/logspec`,
     because the kind vocabulary must not depend on `containerlogs`, which
     imports `refresh` (`resource-kind-registry.md:21-24`). The stream and
     resolver regression tests are named in the Phase 8 checklist, including
     the future-Job test (`lifecycle_test.go:317`).
2. **P2, `panel.logs` lost Node.** Confirmed: Node logs are their own
   service (`backend/node_logs.go:15-35`), and container-log scopes require a
   namespace (`resolve.go:33-35`).
   - Changed: `panel.logs` is a union of two sources. Container logs come from
     `Descriptor.Logs`; Node logs from a declared `ObjectPanel.NodeLogs`. The
     generator rejects a kind with both.
   - Added: regression assertions for Node's mode (the generator pin and
     `useObjectPanelTabs.test.tsx:192`).

## Review round 3 (2026-10-23)

1. **P2, kind casing in the log-target table.** Confirmed:
   - fetch keeps `Deployment` (`resolve_test.go:70-73`);
   - the stream parser lowercases it (`handler.go:589`, pinned by
     `handler_test.go:90`) and passes it on through `Options.target()`
     (`types.go:36-42`);
   - today's checks accept both only because each one lowercases
     (`target_identity.go:18`, `resolve.go:88`).

   Changed:
   - `logspec.Targets` is a type with an unexported map. One `key` function
     trims group and version and matches them exactly, and lowercases the
     kind. Construction, validation, and dispatch all go through it.
   - Added a regression that sends the same canonical scopes through fetch
     and the real stream request parser, plus `Lookup` and collision cases.

## Self-review (2026-10-23)

- **"UI tab choices in Go is a layering leak."** This is Q1. The precedents
  are `Actions.Aliases` (read only by the generator for the frontend) and the
  `objectMap` flag.
  The alternative stays compile-checked.
- **"Group-and-kind lookup is a behavior change."** Yes, for custom resources
  that share a name: Q4, with red tests. Version-agnostic lookup is
  deliberate (Q3).
- **"Deleting the panel's action flags drops permission queries."** This
  risk is unresolved, so Phase 2 traces it before deleting (section E).
- **"Phase 1 is not a pure refactor."** The behavior lookup ignores case, so
  it also matches lowercase `node` and `service`, which the alias lookup
  missed (`objectActionCapabilities.ts:17-27`; Node and Service have no
  aliases). Versions stay exact. Phase 1 checks that no caller relies on that
  miss [unverified].
- **"Event Diff is a kind decision."** It is not: an Event row without an
  involved object keeps Diff (`useObjectActions.tsx:133-135`). It stays in C,
  with no facet.
- **"Facets restate producers."** Pods, logs, and metrics get agreement tests;
  logs can be fully derived (Phase 8).
- **"The table grows without bound."** Each facet must name a frontend
  consumer in this inventory. Nothing is emitted speculatively.
- **"Section C hides real dispatch."** Each C row either renders its own DTO,
  names its own constant kind, or is copy or color. Rows that make a decision
  for another kind moved to A or D.
- **Review round 1 corrections.** The first draft claimed the logs resolver
  ignores the group. It does not: `ParseTargetScope` validates the complete
  GVK first (`resolve.go:36`). Q4, Q8, and the agreement tests now say so.
- **Counts re-verified on this base:**
  - `RESOURCE_CAPABILITIES` has 32 entries;
  - `kindAliasMap` has 41 short names, 2 label overrides, and 49 kubectl
    aliases;
  - `BUILTIN_KIND_VIEWS` has 41 rows;
  - `permissionSpecs.ts` has 115 spec rows;
  - the registry has 40 kinds.
