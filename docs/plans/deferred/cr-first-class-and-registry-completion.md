# Plan: First-Class Custom Resources & Registry Completion

Distilled from the 2026-07-08/09 plugin-architecture design discussion. The
plugin system itself is **not** part of this plan. These are the standalone
improvements that discussion surfaced — each justifies itself on its own
terms, and together they carve the seams a future module system would need.
The plugin vision, candidate plugin list, and the seam-by-seam mapping live
in the Plugin-readiness ledger at the end of this file (captured from the
former `docs/todo.md` notes — this plan is now their home).

**Goal:** finish the resource-kind registry consolidation to its logical end,
and make the generic custom-resource experience first-class.

**Non-goals (explicitly out of scope):**

- No plugin/module runtime, no runtime-loaded descriptors, no distribution.
- No CEL engine. Phases 1–2 need only JSONPath, which `additionalPrinterColumns`
  already speak (evaluate with `k8s.io/client-go/util/jsonpath`, as kubectl does).
- No YAML-authored built-in kinds. Built-ins stay Go-authored.
- No AI/conversational features.

**Baseline evidence (verified 2026-07-09):**

- `additionalPrinterColumns` are read nowhere in the app (repo-wide grep: 0 hits).
- CR table rows get five fixed columns — Kind, Name, owning CRD, Status, Age
  (`frontend/src/modules/namespace/components/NsViewCustom.tsx:92`); Status/CRD
  are `sortable:false`.
- Custom tables page through the **catalog** engine and hydrate only the
  returned page: rows come from `useBrowseCatalog`, enriched afterward
  (`frontend/src/modules/browse/hooks/useCatalogBackedCustomResourceRows.ts:40-57`);
  `HydrateCatalogCustomRows` works only on caller-provided page rows, by
  design, to avoid the legacy full-CRD fanout domains
  (`backend/app_object_catalog.go:601-605`). Catalog sort keys are the fixed
  set name/kind/namespace/age/creationTimestamp
  (`backend/refresh/snapshot/catalog.go:161-167`,
  `backend/objectcatalog/query_engine.go:55-81`). Anything sorted server-side
  must therefore exist **before** paging — page-time hydration can never feed
  sort.
- The generic CR object panel renders only header + API group +
  labels/annotations (`GenericOverview.tsx:43`); `FetchObjectDetails` returns
  `ErrObjectDetailNotImplemented` for CRs (`backend/object_detail_provider.go:136`).
- CRs enter the object map only as identity-only records (ref + timestamp, no
  owners — `object_map.go:373-383`): they can already appear as owner
  *endpoints* of built-in children's edges (`resolveOwner` matches by
  UID/identity, `object_map.go:1163-1174`) but originate no edges and register
  no collector; the Map tab is gated by the closed set `MAP_SUPPORTED_KINDS`
  (`frontend/src/modules/object-panel/objectPanelRef.ts:62`).
- Backend already derives generic CR status from phase/state/ready/conditions
  (`backend/resources/customresource/model.go:119`) — tables show it, the
  panel does not.
- Three parallel data-source patterns feed the store: typed factory informers,
  dynamic informers for CRs (`backend/refresh/resourcestream/manager.go:526`),
  and the bespoke Helm storage informer wired inline into the shared factory
  (`backend/refresh/informer/factory.go:62-67`).

**Cross-cutting rules for every phase:**

- **Multi-cluster:** CRDs differ per cluster, so printer-column metadata, UI
  capabilities, and map membership are all per-cluster facts. Every new
  contract payload carries `clusterId`; nothing may cache column/capability
  metadata keyed on kind alone.
- **Red/green TDD** per behavior change; `mage qc:prerelease` green before any
  phase is reported complete.
- Per-version columns: a CRD declares printer columns per served version; use
  the version the informer actually watches. Fall back to the generic five
  columns when a CRD declares none.

---

## Phase 1: `additionalPrinterColumns` in CR tables

**Outcome:** a cluster with cert-manager installed shows Certificates with
Ready / Secret / Age columns (whatever the CRD declares) in the Custom views
and Browse — sortable and filterable server-side, like built-ins.

- [ ] **1.1 Column metadata source.** Read printer columns from the CRD via the
      existing typed apiextensions lister (already used for CRD discovery,
      `backend/refresh/snapshot/cluster_custom.go:71`). Parse/validate the
      JSONPath once per CRD version, not per row. A CRD update that changes
      printer columns invalidates every already-projected row and cannot be
      healed in place — the ingest store never retains the source object
      (`backend/refresh/ingest/projecting_store.go:106-110`) — so column
      changes route through 1.2's upgrade-restart path.
- [ ] **1.2 Query provider (decided — reviewer finding, 2026-07-09).** Printer
      columns cannot ride the current table path: Custom tables page through
      the catalog engine (fixed sort keys) and hydrate only the returned page
      (see baseline evidence), so page-time hydration can never feed
      server-side sort. Since printer columns apply only in single-kind scope
      (1.5), serve single-kind CR views from a **dedicated CR query provider**:
      a dynamic-informer-backed maintained store for that one GVR, projecting
      printer columns into a dynamic-columns row at ingest. Bounded cost: one
      reflector for the viewed kind, acquired on view entry and released on
      leave (the panel-pods-window lifecycle pattern), permission-gated with
      the honest denied message.
      **Reflector ownership (decided — reviewer finding, 2026-07-09):** the
      existing on-demand API cannot be reused as-is —
      `RegisterDynamicCatalogReflector` is singleton-per-GVR and returns
      `false` when an entry exists (`backend/refresh/ingest/manager.go:353-361`),
      and `StopReflectorFor` cancels and evicts the entry outright
      (`manager.go:396-410`), so a naive provider would either fail to
      register behind a catalog-promoted reflector or tear the catalog's
      reflector down on view leave. Decision: extend the ingest manager with a
      **ref-counted shared dynamic entry** — acquire(gvr) starts the reflector
      if absent or increments the count, release decrements, cancel only at
      zero; the catalog's promotion holds its own ref. The shared entry's
      projecting store carries both halves of the existing Bundle shape: the
      catalog projection (as today, `manager.go:362`) plus a table half fanned
      to the provider's maintained store through a table sink.
      **Projection upgrade on acquire (validated finding, 2026-07-09):**
      ref-counting alone is not enough — the two consumers differ in
      projection shape, not just lifecycle. A catalog-promoted entry projects
      a catalog-half-only bundle (`catalogProjectionFor`,
      `ingest/manager.go:435-446`); the projection is fixed at store
      construction and the source object is never retained
      (`ingest/projecting_store.go:106-110,180-186`); `SetRetainTable` is
      pre-start-only and cannot produce a Table half the projector never
      emitted (`projecting_store.go:188-195`); table sinks have no late-attach
      replay (`AddSink`, `projecting_store.go:294-296` — only `AddCatalogSink`
      replays the already-ingested set, `:306-313`); and
      `RewriteBundlesByIndex` rewrites stored bundles only, with no source to
      re-project from (`projecting_store.go:631-645`). Decision:
      **upgrade-by-restart** — when acquire needs the table half and the
      shared entry is catalog-only, the manager restarts that entry's
      reflector with a dual-projection store (table sink registered before
      start; catalog sinks replayed exactly as at promotion). Cost equals the
      original promotion relist, bounded to the one viewed kind on explicit
      navigation; stored bundles stay catalog-only-sized (`retainTable` stays
      false — the Table half is fanned to the sink and dropped). Rejected
      alternative: always projecting both halves from promotion time parses
      printer columns for kinds nobody views and reintroduces the
      double-storage `retainTable` exists to avoid
      (`projecting_store.go:166-173`). Releasing the last table ref must
      detach the provider's store (sink removal or a symmetric downgrade
      restart — decide with the lifecycle tests; no leaked sinks). One watch
      per GVR, ever — no double informers on high-cardinality kinds.
      Column definitions come from the printer-column entries
      themselves — `name`, required+validated `type`
      (`integer`/`number`/`string`/`boolean`/`date`), optional `format`,
      `priority`, `jsonPath` (`CustomResourceColumnDefinition`, apiextensions
      v1 `types.go:227-249`; `type` required and validated,
      `validation.go:828-836`) — NOT inferred from the CRD's OpenAPI schema.
      `priority > 0` marks the overflow set (kubectl `-o wide` behavior):
      default table shows priority-0 columns; higher-priority columns surface
      in the object panel. The catalog and its engine are NOT extended —
      catalog `Summary` stays slim.
- [ ] **1.3 Server-side sort/filter.** `typedTableQueryAdapter` pattern
      (`backend/refresh/snapshot/typed_table_query.go:58`) over the new
      provider's dynamic columns: `SortValue`/`NumericSort` per declared type;
      timestamps sort like `AgeTimestamp`. Publish the per-CRD column
      vocabulary through `ResourceQueryCapabilities`
      (`backend/refresh/snapshot/resource_query_contract.go:205`) so
      unsupported sorts surface as issues, per existing contract. Verified
      feasible (self-review, 2026-07-09): capabilities are built per snapshot
      response, not fixed at registration, and per-scope narrowing already has
      precedent (`capabilitiesWithAvailableKinds`,
      `table_query_issues.go:74-95`, used by `namespace_workloads.go:513-515`);
      the unsupported-sort issue machinery (`typed_table_query.go:147-165`)
      exists only on the typed serve path — which is the provider 1.2 routes
      to; the catalog path has neither, another reason 1.2's routing decision
      is load-bearing.
- [ ] **1.4 Frontend rendering.** Dynamic column definitions in the custom/Browse
      tables, rendered through the existing `columnFactories` keyed by column
      type (`frontend/src/shared/components/tables/columnFactories.tsx`). No
      per-kind TSX.
- [ ] **1.5 Mixed-kind handling (decided).** Printer columns apply only when
      the table is scoped to a single kind (kind filter or single-CRD view);
      mixed-kind views keep the generic five columns and the existing
      catalog-paged + page-hydrated path
      (`useHydratedCustomCatalogRows.ts:108`) unchanged. Matches kubectl
      behavior and avoids column-set thrash.
- [ ] **1.6 Scope transition.** Entering/leaving single-kind scope switches
      provider (catalog-backed ↔ CR query provider). Quiet-filtering rules
      apply: no flash, no focus loss, preserved rows while the first page of
      the new scope is in flight.
- [ ] **1.7 Refresh-domain contract (reviewer finding, 2026-07-09).** The
      provider is a new table domain and owes the full domain contract:
      backend registration in `backend/refresh/system/registrations.go`
      (permission-gated), an entry in
      `backend/refresh/domain/refresh-domain-contract.json`, **signal
      coverage** per `docs/architecture/refresh-system.md:96` — the provider's
      dynamic informer supplies resource-stream change signals; authored poll
      timing is the stream-down fallback only — frontend counterparts
      (`types.ts` RefreshDomain union + payload map, `refresherTypes.ts`,
      `domainRegistrations.ts`), diagnostics stream metadata, and the
      backend+frontend contract tests that lock both sides to the JSON
      (`.agents/skills/refresh-subsystem/SKILL.md:39-64`).
- [ ] **1.8 Single-kind identity is GVR, not a kind string (decided —
      reviewer finding, 2026-07-09).** Kind strings are ambiguous: colliding
      CR kinds from different operators are a documented real case
      (`NsViewCustom.tsx:60-64`), the browse filter payload is
      `kinds: string[]` (`browseCatalogData.ts:14-18`), and catalog filter
      options expose only `KindInfo.Kind` (`objectcatalog/types.go:232-236`).
      Entering printer-column mode therefore requires an unambiguous GVR:
      define a GVK/GVR-valued selection contract (single-CRD navigations
      already carry full identity; a kind-string filter that maps to more
      than one catalog kind-identity stays in the generic catalog mode). Per
      the object-reference critical rule, the new provider's scope carries
      group+version+kind — never kind alone.

**Tests:** red/green on projection (fixture CRDs with typed columns), sort
correctness (numeric + date), per-cluster isolation (two clusters, same kind,
different CRD columns), fallback when no columns declared, mixed-kind view
keeps generic columns, provider lifecycle (informer torn down on view leave;
no leaked reflectors), permission-denied path, catalog-path parity for the
shared five columns.

---

## Phase 2: Generic CR object panel

**Outcome:** opening any CR shows a real Details tab: status block,
conditions table, printer-column facts, metadata — instead of today's
header-and-labels shell.

- [ ] **2.1 Backend generic detail.** New generic CR detail fetch (dynamic
      client read, GVR via the catalog resolver as YAML mutation already does,
      `backend/object_yaml_mutation.go:228-245`) returning a
      `CustomResourceDetails` DTO: identity, generic status
      (`customresource/model.go` presentation), conditions, printer-column
      facts, top-level spec/status scalar summary. Wire into
      `FetchObjectDetails` as the fallback instead of
      `ErrObjectDetailNotImplemented` for catalog-known CRs — this upgrades an
      existing generic path, not a new one: the snapshot consumer already
      converts `ErrObjectDetailNotImplemented` into a minimal generic payload
      rather than an error (`refresh/snapshot/object_details.go:114-142`), and
      the frontend treats it as non-fatal (`useObjectPanelRefresh.ts:83-84`).
      **Wails binding (self-review, 2026-07-09):** the genappbindings table
      generates strictly per-kind `Get<Name>` wrappers
      (`internal/genappbindings/render.go:221-248`), so a kind-generic CR
      fetch does not fit a table row — add a hand-written bound App method
      (the pods/helm/apiextensions `detailExtras` precedent,
      `render.go:144-148`) so Wails emits the `CustomResourceDetails` TS model
      class that 2.3's drift check requires.
- [ ] **2.2 Frontend descriptor.** One `customResource` Overview descriptor
      (ordered `field`/`status`/widget items per `Overview/schema.ts`) using
      stock widgets where they exist: `ResourceStatus`, `ResourceMetadata`.
      There is no stock conditions widget (validated 2026-07-09 —
      `ConditionList` is descriptor-local, `descriptors/gateway.tsx:124`, and
      no shared ConditionsTable exists): extract it into a shared conditions
      widget as part of this item. Registered as the fallback path in
      `Overview/index.tsx:145`, replacing the near-empty `GenericOverview`
      branch for CRs.
      **Plugin-foundation constraint (gap closure, 2026-07-09):** this
      descriptor must stay within the serializable subset of the schema —
      plain-data `OverviewField` forms (string `label`, `field` key,
      `mono`/`fullWidth` literals — `Overview/schema.ts:36-50`) plus the
      `status` item. Anything that needs a render function (the conditions
      widget) enters as a NAMED shared widget, never an inline closure.
      `OverviewWidget` is function-valued by design (`schema.ts:57-62`), so
      widget-by-name indirection is the one piece a future data-authored
      descriptor loader would add — keep this descriptor trivially
      convertible to data, and reject review-time additions that break that.
- [ ] **2.3 Coverage drift-check (mechanism decided — reviewer finding,
      2026-07-09).** The drift check iterates `registeredDescriptors` and
      instantiates `descriptor.dtoClass` (`driftCheck.test.ts:13-19`), and the
      current fallback path bypasses registration entirely
      (`Overview/index.tsx:145-158`); kind-name registry lookup can't work for
      unbounded CR kinds. Mechanism: register the new `customResource`
      descriptor in the `descriptorRegistry` registrations list (so it appears
      in `registeredDescriptors` with `dtoClass: CustomResourceDetails`), and
      dispatch to it in `index.tsx` on an **explicit discriminator field**,
      keeping `GenericOverview` only for objects with no detail at all.
      **`instanceof` dispatch is impossible (self-review, 2026-07-09):** the
      detail payload is plain JSON off the refresh snapshot
      (`useObjectPanelRefresh.ts:60` → `objectDetailModel.ts:139` →
      `index.tsx:134`); production code never constructs generated model
      classes (`createFrom` appears only in tests), so `instanceof
      CustomResourceDetails` is always false at runtime. Mechanism: the Go
      DTO carries a constant discriminator (e.g. `detailKind:
      "customResource"`, JSON-serialized), and `index.tsx` selects the
      descriptor on `detailPayload?.detailKind === 'customResource'` — a new
      dispatch branch beside the kind-name `byKind` lookup, which cannot
      route unbounded CR kinds.

**Tests:** DTO builder red/green against fixture CRs (with/without
conditions/status), descriptor renders through `OverviewRenderer`, panel shows
status parity with the table row for the same object.

---

## Phase 3: Registry-published UI capabilities (kill the closed frontend kind-sets)

**Outcome:** the frontend stops mirroring per-kind capability knowledge in
hardcoded sets; the backend registry is the single source. The full inventory
of sets in scope — and the two families deliberately excluded — is in 3.7, so
this outcome is not silently partial. Prevents backend/frontend drift as kinds
change; unblocks Phase 4.

- [ ] **3.1 Contract.** Backend publishes per-kind UI capabilities from one
      chokepoint with three sources: rows derived from `kindregistry.All`
      facets (map-supported = Collector/GatewayCollector/Edges present,
      `kindspec/descriptor.go:118-128`; restart/rollback/scale from the
      `Workload` facet's nil-func semantics, `descriptor.go:33-47`;
      port-forward from the `PortForward` facet, `descriptor.go:142-145`);
      explicit synthetic rows for app-owned kinds not in the registry
      (HelmRelease — see 3.5); and catalog-sourced rows for CR kinds.
      **Authoring scope (validated 2026-07-09):** descriptors carry NO
      delete/edit/logs/shell/debug flags and NO tab set today
      (`descriptor.go:91-146`) — that per-kind data must be newly authored on
      the descriptor for ~39 kinds; it is new registry data, not derivation or
      relocation. This
      contract is **net-new** (self-review, 2026-07-09): the existing
      `ResourceQueryCapabilities` channel is a table query-surface contract
      (sort/filter/search/kindVocabulary) consumed only by table plumbing —
      it carries no map/tab/action semantics and is not the vehicle here.
      Per-cluster payload (Gateway API kinds exist only where detected).
      **CR map-supported sourcing (self-review — fixes a Phase 3↔4
      contradiction):** CR kinds have no registry facet, so their
      map-supported flag cannot derive from Collector/Edges; the
      catalog-sourced rows carry it as a constant for catalog-known CR kinds,
      and it stays **false until Phase 4's dynamic collection step ships**,
      then flips — the Phase 3→4 dependency is bidirectional for this one
      flag.
      **Plugin-foundation constraint (gap closure, 2026-07-09):** the
      contract schema must be forward-extensible in two directions without a
      breaking change: (a) capability rows may later come from sources not
      known at compile time (a plugin registry) — the three-source chokepoint
      above already proves the shape, keep it open; (b) action entries must
      be able to grow from booleans into verb *definitions* (id, display
      label, confirmation, dispatch target) so plugin verbs beyond the
      built-in set (e.g. an ArgoCD "sync") have somewhere to land. Shape the
      payload accordingly (actions as a keyed map, not a fixed bool struct);
      implementing plugin verbs stays out of scope.
- [ ] **3.2 Replace `MAP_SUPPORTED_KINDS`**
      (`frontend/src/modules/object-panel/objectPanelRef.ts:62`) with the
      published capability; delete the set.
- [ ] **3.3 Replace the live capability map; delete the dead one (corrected —
      validated finding, 2026-07-09).** `RESOURCE_CAPABILITIES`
      (`frontend/src/modules/object-panel/components/ObjectPanel/constants.ts:19`)
      is the live static layer (consumed via
      `useObjectPanelFeatureSupport.ts`) — the published contract replaces it.
      Its "parallel twin" `CAPABILITIES_BY_KIND`
      (`Details/Overview/registry.ts:25-78`) is production-dead: its only
      reader `getResourceCapabilities` (`registry.ts:91-92`) has no production
      caller — `Overview/index.tsx` imports only `overviewRegistry` from that
      module (`index.tsx:11`); every other reference is in tests. The maps'
      disagreement (`edit`/`exec` only in the dead map; `shell`/`debug` only
      in the live one) is therefore not a live bug — delete
      `CAPABILITIES_BY_KIND`, `getResourceCapabilities`, and their tests
      outright (dead-code rule) rather than reconciling. RBAC/SSAR gating in
      `useObjectPanelCapabilities.ts` is unchanged — this replaces only the
      static per-kind feature layer beneath it.
- [ ] **3.4 Replace kind-enumeration gates** — tab `onlyForKinds` lists
      (`constants.ts:97`, filter at `useObjectPanelTabs.ts:86`) AND
      `WORKLOAD_SCOPE_KINDS` (`Pods/objectPanelPodsScope.ts:12-18`, gate at
      `:45`), which by its own comment mirrors the pods-tab list. Both become
      one published capability ("has pods sub-table" + its scope shape,
      derived from the registry `Workload` facet), so the tab and the scope
      builder cannot drift apart.
- [ ] **3.5 Synthetic-kind capability source (decided — reviewer finding,
      2026-07-09).** HelmRelease is NOT in `kindregistry.All`
      (`backend/kind/kindregistry/registry.go:66-106`) — its frontend support
      is synthetic (`constants.ts:66`, `useObjectPanelFeatureSupport.ts:40-41,56-57`,
      `HELM_RELEASE_GVK` at `objectPanelRef.ts:60`) and *subtractive*: helm
      releases drop the universal Events/YAML/Map/Pods tabs and add
      Manifest/Values (`useObjectPanelTabs.ts:64-76`). Decision: the backend
      capability publication has two sources behind one chokepoint —
      registry-derived rows plus explicit app-owned synthetic rows (helm) —
      and the contract expresses the **full tab set per kind**, not additive
      flags, so subtractive kinds are representable. Phase 5.5 may later fold
      the helm row into a descriptor-supplied one; the frontend never knows
      the difference.
- [ ] **3.6 Dead-set removal.** Delete the closed sets/maps and their tests;
      bottom-up removal per repo rule (no vestigial wiring left).
- [ ] **3.7 Complete closed-set inventory (validated finding, 2026-07-09).**
      The sets in 3.2-3.4 are not the whole story. Also IN scope — they gate
      actions across gridtable/object-map/object-panel and derive cleanly from
      existing registry facets: the six per-kind enumerations in
      `frontend/src/shared/actions/objectActionPolicy.ts`
      (`WORKLOAD_KIND_MAP` `:16`; `RESTARTABLE_KINDS`/`ROLLBACKABLE_KINDS`/
      `SCALABLE_KINDS` `:129-131`, derivable from the `Workload` facet's
      nil-func semantics; `CORDONABLE_KINDS`/`DRAINABLE_KINDS` `:132-133`,
      Node-only, published as explicit rows; consumer contexts at `:195`), and
      `PORT_FORWARD_TARGET_CAPABILITIES`
      (`frontend/src/modules/port-forward/targetCapabilities.ts:22`, derives
      from the `PortForward` facet). Deliberately OUT of scope, so the phase
      outcome stays honest: `UTILIZATION_KINDS`
      (`Details/useUtilizationData.ts:13`) and `workloadMetricKinds`
      (`core/resource-metrics/scope.ts:10`) — metrics vocabulary owned by the
      serve-time metric join, a separate contract — and the per-kind
      permission-prefetch specs (`core/capabilities/permissionSpecs.ts:23-37`)
      — RBAC prefetch tuning, not capability semantics.

**Tests:** contract test that every registry kind publishes a capability row;
frontend gating tests move from set-membership fixtures to capability-payload
fixtures; drift test that no frontend module re-introduces a kind enumeration
for these decisions (grep-based, mirroring existing registry drift tests).

---

## Phase 4: CRs in the object map (owner-reference + declarative rule edges)

**Outcome:** a Karpenter NodeClaim owned by a NodePool shows a Map tab with
its owner chain; any CR with `ownerReferences` participates in the graph, and
declared field references (4.4) draw edges owner chains can't express.
Depends on Phase 3 (Map-tab gating must be capability-driven first).

- [ ] **4.1 Dynamic CR owner collection (reworked — reviewer finding,
      2026-07-09).** The collector registry cannot host this: it is derived by
      looping `kindregistry.All` for `d.Collector`
      (`object_map_collector_registry.go:25-33`), and CR kinds have no
      registry descriptor. CRs already enter the map index as identity-only
      records via `addCatalog` (`object_map.go:373-383` — ref + timestamp, no
      `obj`, no `owners`), and owner edges are built solely from
      `record.owners` (`object_map.go:1114-1119`), so today's CR records can
      never *originate* edges (they can already be owner endpoints of built-in
      children's edges — `resolveOwner` matches byUID/byIdent,
      `object_map.go:1163-1174`). Add an explicit **dynamic collection step**
      in the map build: for catalog-known CR kinds in the map's scope, list
      via the dynamic client (GVR resolved through the catalog resolver, as
      YAML mutation does). New dependency (validated 2026-07-09): the builder
      holds neither today (`objectMapBuilder`, `object_map.go:127-143`; its
      registration passes no dynamic client, `registrations.go:577-589`), and
      the catalog Service exposes `ResolveResourceForGVK`
      (`objectcatalog/lookup.go:64`) but not its dynamic client — so this step
      injects a `dynamic.Interface` into the object-map registration. Then
      **upgrade** the existing identity-only records in
      place (merge by identity via `byIdent` — no duplicate nodes) with
      `owners` + labels + generic status. Permission-gated per GVR exactly
      like `collectTyped`'s `allowed()` skip (`object_map.go:395-399`). Node +
      owner edges only; no per-kind semantics (no scalable-workload flags, no
      reverse-expansion rules).
- [ ] **4.1a Cost bound (design decision before implementation).** A cluster
      can serve hundreds of CR kinds; the dynamic step must not fan out a LIST
      per CRD per map build. Bound it: only kinds the catalog reports as
      having instances in the map's scope, with a per-build kind cap and a
      `log`-visible skip count — silent truncation reads as full coverage.
- [ ] **4.2 Capability flow.** Flip the catalog-sourced CR map-supported flag
      in Phase 3's contract to true when this phase's dynamic collection step
      lands (see 3.1 — the flag is constant-per-CR-kind and gated on this
      phase existing, NOT derived from any collector facet); Map tab appears.
- [ ] **4.3 Ordering (revised — gap closure, 2026-07-09).** Owner edges land
      first (4.1-4.2) and ship on their own. Field-reference edges are no
      longer deferred out of the plan — they land via 4.4's declarative rule
      vocabulary, because that vocabulary is the plugin architecture's edge
      seam (see the Plugin-readiness ledger). Selector-based edges
      (label-selector matching) remain future work: they need indexed
      selector evaluation, a different mechanism from path references.
- [ ] **4.4 Declarative reference-rule edges (gap closure, 2026-07-09).**
      Define the reference-rule vocabulary as data: a rule =
      {source GVK, JSONPath to the referenced name (+ optional namespace
      path; default same-namespace, cluster-scoped targets namespace-free),
      target GVK, edge label}. Evaluate rules inside 4.1's dynamic collection
      step — which already holds the full unstructured object — using the
      same `k8s.io/client-go/util/jsonpath` engine Phase 1 adopts, and
      resolve targets through the index's identity lookups exactly as owner
      resolution does (`byIdent`/`byUID`, `object_map.go:1163-1174`). Rules
      register as data literals at one chokepoint (mirroring the kind
      registry pattern); the vocabulary itself is serializable, so a plugin
      can later ship rules without code. Boundary: built-in kinds keep their
      Go `Edges` facet — the rule engine is the CR-side (dynamic-step)
      mechanism only. Tolerances: absent target → no edge (same as
      absent-owner); invalid JSONPath → rejected at rule registration,
      logged once. Ship with fixture rules in tests plus at least one
      real-world rule chosen at implementation time as the proving example.

**Tests:** map snapshot with fixture CR owner chains (CR→CR and CR→built-in
owners), absent-owner tolerance, per-cluster isolation, Map tab gating;
rule-engine coverage — fixture CRD + rule builds the edge (CR→built-in and
CR→CR targets), absent-target tolerance, invalid-JSONPath rejected at
registration, per-cluster rule isolation.

---

## Phase 5: `Source` facet — one registration path for all data sources

**Outcome:** the three parallel source patterns (typed factory, dynamic CR
informers, bespoke Helm storage informer) become one descriptor facet;
Helm/HPA stop being special-cased in shared chokepoints. Pure tech-debt
payoff; largest and riskiest phase — read
`.agents/skills/refresh-subsystem` guidance before starting, and re-verify the
lock-ordering constraints noted in project memory (ingest/catalog ABBA
deadlock; unscoped BundleSink multi-kind wipe).

- [ ] **5.1 Facet definition.** `Source` on `kindspec.Descriptor`: typed
      (shared factory), dynamic (per-GVR dynamic informer), or custom
      (implementation-owned informers + sink). Shape constraint (validated
      2026-07-09): `kindspec` is a declaration-only leaf package
      (`descriptor.go:11-13`) and no existing facet owns lifecycle — function
      facets receive runtime deps as call parameters (`WorkloadOperations`,
      `descriptor.go:37-47`). The custom variant must follow that shape: a
      declarative spec/constructor the refresh managers bind deps to and whose
      lifecycle THEY own, not a pre-bound `Start(ctx, sink)` closure on the
      descriptor.
- [ ] **5.2 Typed + dynamic migration.** Express current typed-factory and
      dynamic-CR wiring through the facet (mostly relocation; the registry
      informer conversion already did the typed half — verify against
      `objectcatalog/informer_registry.go`).
- [ ] **5.3 Helm as custom source.** Move the helm-storage informer wiring out
      of the shared factory
      (`refresh/informer/factory.go:62-67,160-162,220-238,315-317,499`; the
      type + constructor live in the sibling `refresh/informer/helm_storage.go`)
      behind a Helm-owned custom source. The `owner=helm` filtering, decode,
      and release modeling stay in `backend/resources/helm`/`refresh/informer` —
      relocated behind the facet, not rewritten.
- [ ] **5.4 HPA behind the facet.** Retire the `CustomStreamHandler` bespoke
      wiring (`backend/resources/hpa/streamdescriptor.go:31`,
      `stream_descriptor_dispatch.go:31`) onto the same custom-source facet.
      **The handler is not just HPA-row streaming** (reviewer finding,
      2026-07-09): `handleHPAEvent` also signals the scale-target workload row
      on add/delete/modify — including signaling the OLD target when an HPA
      retargets (`resourcestream/manager.go:888-922`; the descriptor's own
      header documents this, `hpa/streamdescriptor.go:4-7`). The migration
      must preserve these cross-row signals. Acceptance coverage already
      exists (corrected — validated finding, 2026-07-09):
      `TestManagerHPADeleteRefreshesTargetWorkloadRow`
      (`resourcestream/manager_test.go:1110`) AND
      `TestManagerHPAUpdateRefreshesOldAndNewTargets` (`manager_test.go:1143`
      — retargets web-old→web-new and asserts BOTH workload rows refresh,
      `:1180-1181`). Do not rewrite these red/green (they already pass); they
      must stay green across the migration, with new tests only for genuinely
      new facet behavior.
- [ ] **5.5 Chokepoint consolidation (follow-up slices, each independently
      green):** Helm's remaining special cases move onto descriptor facets —
      delete-action dispatch (`backend/object_actions.go:154-155`), detail
      dispatch (`backend/object_detail_provider.go:64-141`), cache
      invalidation (`backend/response_cache_invalidation.go:309-355`). Each
      slice removes the kind-named branch from the shared file.

**Tests:** existing refresh/orchestrator harness for source lifecycle;
regression tests that Helm releases and HPA rows stream identically before/after
(fixture parity); deadlock regression tests stay green; grep done-test per
slice: the shared chokepoint file no longer names `helm`.

---

## Phase 6: descriptor-driven table columns (mechanism required; conversions opportunistic)

Backend publishes column metadata (name/type/style) alongside query
capabilities; frontend renders tables from it via `columnFactories` instead
of hand-written per-domain column hooks. Reframed (gap closure, 2026-07-09):
the **mechanism** is not opportunistic — it is the plugin table seam. Phase 1
proves the renderer for CRD printer columns only; without generalizing it,
plugin tables are forever capped at what a CRD's printer columns declare.
The per-domain **conversions** remain opportunistic — domains share row types
today, so the dedup win is modest.

- [ ] 6.1 Mechanism: generalize Phase 1's dynamic-column contract so any
      domain (not just the CR provider) can publish backend-authored column
      metadata rendered through `columnFactories`. Required for
      plugin-readiness (see ledger).
- [ ] 6.2 Conversions: evaluate which per-domain column hooks become pure
      metadata; convert only where it deletes more code than it adds.

---

## Open questions (resolve before the phase that needs them)

Resolved 2026-07-09 (external review): printer values do NOT become
catalog-owned query fields — single-kind CR views move to a dedicated typed
query provider before paging (1.2), and the catalog stays slim. HelmRelease
capabilities come from an app-owned synthetic source beside the registry
rows, behind one publication chokepoint (3.5). The column-cap question is
answered by the printer columns' own `priority` field (default table =
priority 0; higher priorities overflow to the panel — 1.2). Single-kind
selection is GVR-valued, never a kind string (1.8). The CR provider shares
one ref-counted dynamic reflector per GVR with the catalog (dual
catalog+table projection via upgrade-by-restart on acquire — 1.2), never a
second watch. CR owner collection is
an explicit dynamic map-build step upgrading catalog-seeded identity-only
records, not a registry collector (4.1/4.1a).

1. **Phase 2:** how much of `spec`/`status` to summarize generically without
   turning the panel into a YAML dump (proposal: top-level scalars only,
   conditions get the table, everything else stays in the YAML tab).
2. **Phase 3:** transport — extend the existing capabilities/snapshot channel
   or a new registry-contract endpoint (trace the producer/consumer contract
   first per the cross-layer rule). Whatever is chosen must satisfy 3.1's
   forward-extensibility constraint (rows from compile-time-unknown sources;
   actions growable into verb definitions).
3. **Phase 5:** whether `object-helm-manifest`/`object-helm-values` domains
   (`refresh/system/registrations.go:561-566`) move in 5.5 or stay as
   documented Helm-owned domains.

---

## Plugin-readiness ledger (added 2026-07-09)

**The vision (captured 2026-07-09 from `docs/todo.md`, which this replaces):**
build a plugin architecture to allow better support for CRDs — people can
load support for non-standard CRDs into the app without having to rebuild
it, and plugins can be versioned and released separately from the app.

Candidate plugins from that sketch:

- **Core** — the core Kubernetes resources: built-in, cannot be removed or
  disabled; proves out the plugin architecture by being its first consumer.
- **Gateway API**
- **ArgoCD**
- **Helm**
- **Karpenter**
- **AWS ACK** controllers and objects

This plan is that architecture's foundation, not its implementation. In a
Wails app, "without rebuilding" means a plugin's contribution must ultimately
be declarative data interpreted by generic engines — every seam below is
scored against that constraint.

**Delivered by this plan:**

- **One registration path per kind** (Phase 5 `Source` facet + the existing
  registry): a plugin reduces to "a set of descriptors." Helm-as-custom-source
  (5.3) proves an app-owned, non-typed source rides the same path.
- **Backend-published, per-cluster UI capabilities** (Phase 3): tabs, actions,
  and map support arrive as payload, so a new kind lights up with zero
  frontend changes. 3.5's synthetic rows prove non-registry sources fit the
  contract; 3.1's forward-extensibility constraint keeps it open to
  compile-time-unknown sources and future verb definitions.
- **Payload-discriminator frontend dispatch** (2.3): descriptor selection
  keyed on payload content, not compiled-in kind names — the pattern every
  plugin-facing surface needs for unbounded kinds.
- **Declarative table columns** (Phase 1 printer columns; Phase 6.1
  generalizes to backend-authored column metadata — the plugin table seam).
- **Declarative reference-rule edges** (4.4): the rule vocabulary is
  serializable data a plugin can ship; the engine evaluates it generically.
- **A serializable-subset detail descriptor** (2.2 constraint): converting to
  data-authored descriptors later is a loader problem, not a redesign.

**Left to the plugin project (out of scope here by design):**

- The runtime itself: loading, versioning, isolation, distribution.
- Widget-by-name indirection plus a descriptor loader (`OverviewWidget` is
  function-valued by design, `Overview/schema.ts:57-62`; 2.2 keeps the
  distance to a loader minimal).
- Plugin-supplied action *implementations* — verbs beyond the built-in set
  execute nothing today; 3.1 only guarantees the contract can describe them.
- Selector-based map edges (label-selector matching — 4.3): different
  machinery from path references.
- Whether "Core" literally becomes a loadable module (the Core candidate's
  "proves out the plugin architecture by using it" note above): after Phase 5
  the built-ins are a uniform descriptor set — a de facto static core module.
  Making that unit loadable (and whether Go-authored built-ins ever become
  data-authored) is the plugin project's first decision, not this plan's.
