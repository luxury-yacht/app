# Plan: single source-of-truth Kubernetes kind registry

Status: in progress (2026-06-14) — registration tables + generic stream handlers + generic
object-map collectors + summary constructors + clone-scan cleanup done; remaining per-kind code
verified irreducible (type anchors / typed glue / per-type config), confirmed by an objective
identifier-normalized clone scan.

## Clone-scan cleanup pass (2026-06-14, gate-green)

After the structural consolidations, an objective identifier-normalized clone scan of the whole Go
backend drove a final sweep of every cleanly-removable cluster:
- object-map `collect*` (30) → generic `collectKind[T]` + `ptrsOf`.
- stream `handle*` (24) → generic `streamObjectRow[T,S]`; `broadcastGatewayNetworkUpdate` + 24
  `*FromObject` decoders removed (remaining 10 decoders reimplemented as 2-line `objectAs[T]` wrappers).
- `Build*Summary` (23) → 6 per-domain constructors (`newNetworkSummary`/`newRBACSummary`/…).
- gateway-api Service list/get (16) → generic `listGatewayResources`/`getGatewayResource`.
- 6 `clamp<Setting>` wrappers → existing `clampInt`.
- 3 cloned resume ring buffers → new generic `backend/refresh/ringbuffer.Buffer[T]`.

**Remaining clone-scan clusters are verified IRREDUCIBLE — genericizing them would reduce clarity
(the over-abstraction this plan and AGENTS.md reject), not remove real duplication:**
- `App.Get<Kind>` bindings (Wails type anchors) — already DRY: each delegates to the generic
  `FetchNamespacedResource`/`FetchClusterResource` with a typed closure; the body is the anchor.
- `collectKind`/`streamObjectRow`/`listGatewayResources` CALL SITES — these *are* the minimal
  one-line-per-kind enumeration; the typed closure each carries is the irreducible binding.
- `static_table_query` adapters — per-type query CONFIG (SearchText/SortValue differ by columns).
- `*ConditionFacts` (5) — distinct typed k8s condition structs, no shared interface.
- namespace `list*` wrappers — a generic closure would just *be* the one-line typed-lister body.
True "one descriptor entry per kind" beyond this needs codegen.

## Phase 3a — codegen for ALL standard App.Get bindings (2026-06-14, gate-green)

The codegen mechanism is built and rolled out across every standard `App.Get<Kind>` binding (37):
- `backend/internal/genappbindings` holds the binding descriptor table (`Bindings`) + `Render()`. Each
  row declares only what varies: kind, namespaced, fetch key (HPA/PVC), service ctor, method (network
  Service→GetService). `Render()` emits `backend/resources_generated.go` with all 37 wrappers.
- `//go:generate go run ./internal/genappbindings/cmd -out resources_generated.go` (in `backend/generate.go`).
- The 8 binding-only files (admission/config/constraints/namespaces/network/policy/rbac/storage) were
  deleted; the 3 mixed files (autoscaling/nodes/workloads) had their Get binding surgically removed.
- Two guard tests: `TestAppBindingsGeneratedInSync` (golden — fails if hand-edited or not regenerated)
  and `TestAppBindingsMatchContract` (every binding names a real `BuiltinResources` kind with agreeing
  Namespaced). Generation is idempotent; `models.ts` is byte-unchanged (Wails surface identical), proving
  behaviour preservation.
- **Kept hand-written (genuinely non-standard, VERIFIED):** apiextensions (extra client-nil guard), helm
  (`helm.Dependencies{Common: deps}` + string/map return types), pods (extra `detailed` arg / custom bodies).

**Value:** adding a standard kind's App binding is now one descriptor row + regenerate — the wrapper cannot
drift (golden) and cannot disagree with identity (contract). This eliminates the *binding* surface (one of
the ~13 add-a-kind surfaces). The typed leaves (Service methods, model/summary builders, describe*Facts)
remain hand-written — generating those would be a far larger generator for little gain over the generics
already in place, and would hide genuinely per-kind logic. So this is the correct stopping point for codegen:
the mechanical wrapper is generated; the distinct typed code stays explicit.

## The problem (root cause)

The app supports ~40 Kubernetes kinds. Each subsystem keeps its **own** hand-written
per-kind list/handler. The same per-kind code is copied across ~10 subsystems, so:

- Adding one kind requires editing ~13 surfaces (this is literally the
  `.agents/skills/add-resource` checklist).
- The per-kind coverage differs across subsystems (~46 identities, 43 model builders,
  40 detail-dispatch entries, …). **Phase-1 audit correction (2026-06-14):** most of this
  divergence is INTENTIONAL subset membership, not bugs — e.g. catalog-only kinds
  (CSIDriver/CSINode/Endpoints/Lease/VolumeAttachment) carry identity but deliberately have
  no model/detail/cache; Event has a model but no detail panel. The cleanly-mappable
  dimensions (identity/model/detail/fetcher/cache-invalidation) audited so far are ALIGNED.
  So the case for this work is **drift RISK + maintenance burden** (it's easy to add a kind
  to one subsystem and forget another; ~13 surfaces per kind), NOT a confirmed pile of
  existing bugs. Whether any real gap exists awaits the full multi-file audit (stream rows,
  object-map, listers — naming variance makes single-file greps produce false positives).

Per-kind clone families found by clone scan: `App.Get<Kind>` ×37, test listers ×31,
object-map `collect<Kind>` ×25, stream `handle<Kind>` ×17, `Build<Kind>Summary` ×9,
`<kind>ConditionFacts` ×5, plus frontend `Ns*/Cluster*` views.

Small mechanical merges (done already: `FilterPodsByControllerOwner`,
`FormatConditions`, status/util/replica projection bases) tidy the edges but do not
remove the copying. This plan addresses the root.

## Goal

One **descriptor table** that declares each kind once (its typed behaviours), and every
subsystem **driven or generated from it** instead of re-enumerating kinds. Adding a kind
becomes one descriptor entry; nothing can drift, because there is one source.

## Design

- Extend `backend/resourcecontract` from an identity table into a per-kind **descriptor**:
  identity (already there) + behaviours (informer/list accessor, summary-row builder,
  model builder, detail service, object-map collectability, refresh domain, permission
  verbs, …).
- The irreducible glue is **typed** (each kind binds a different client/object type).
  Prefer **codegen**: generate the parallel per-kind tables from the descriptor with a
  golden-file check in CI. (Hand-rolled generics mostly relocate the closure and add
  indirection; codegen keeps generated code explicit and greppable and avoids the
  over-abstraction the AGENTS rules warn about.)

## Hard constraints (verified this session — must be honoured, not assumed-uniform)

The per-kind code looks identical but is NOT always:
- `App.Get<Kind>` bindings are load-bearing Wails **type anchors** — cannot be collapsed
  away; the descriptor must keep distinct return types (or the codegen emits them).
- Pod-owner filters differ: Job matches by **UID**, ReplicaSet by Kind+UID+Name (no
  controller check), DaemonSet/StatefulSet by Kind+Name.
- `since()` buffers, `*ConditionFacts` are different concrete types (no shared interface).
- HPA pins `autoscaling/v2`.
A naive "assume all kinds are uniform" registry would be simple-but-WRONG. The descriptor
must model these as explicit per-kind overrides.

## Phases (incremental, each gate-green; not a big-bang)

1. **Drift audit (do first, careful — it finds real bugs).** Build the true
   per-kind × per-subsystem coverage matrix, accounting for naming variance
   (e.g. `handleHPAEvent` ↔ HorizontalPodAutoscaler). Every gap is a candidate bug to
   confirm by reading. Deliverable: the matrix + a list of confirmed drift bugs.
2. **Define the descriptor** data model; make ONE subsystem descriptor-driven as proof.
   **DONE (2026-06-14):** cache-invalidation registration → `cacheInvalidationDescriptor`
   tables (30 shared + 8 gateway) + 2 loops, replacing 9 `register*` funcs / ~38 blocks in
   `response_cache_invalidation.go`. A test asserts every descriptor matches a
   `resourcecontract.BuiltinResources` entry (drift guard). Behaviour-preserving, gate-green.
   (Descriptor is local for now; later phases lift group/resource/kind to the shared registry
   and keep only the typed informer closure per subsystem.)
3. **Codegen the divergent tables** from the descriptor — object-map `collect*`, stream
   `handle*`, `Build*Summary` — each behind a golden-file diff against the current
   hand-written version. The diffs are expected to be empty except where they expose
   Phase-1 drift; fix those deliberately.
   **Progress (2026-06-14) — all cleanly-convertible per-kind boilerplate now done by hand
   (no codegen needed), each gate-green + contract-aligned test:**
   - cache-invalidation registration → descriptor table (38 entries) + 2 loops.
   - 32 `New<Kind>Lister` test helpers → one generic `buildIndexer[T]` (~340→70 lines).
   - shared stream registration → `sharedStreamRegistrations` table (14) + loop.

   **Option 1 (generics) chosen over codegen and applied to the stream `handle*` family
   (2026-06-14, gate-green).** 24 direct object→row handlers collapsed to one-line calls of a
   generic `streamObjectRow[T metav1.Object, S any]` + `objectAs[T]` decoder in
   `stream_object_row.go`: first the 14 shared-table handlers, then a second pass over the
   network/gateway ones (`handleIngress`, `handleNetworkPolicy`, `handleGatewayClass`, and the
   7 Gateway-API handlers) — which also let the shared `broadcastGatewayNetworkUpdate` helper
   go. 24 per-kind `*FromObject` decoders and 6 now-unused imports removed; `manager.go` −469
   lines net. The type parameters are inferred from each kind's typed `Build<Kind>Summary`
   projector, passed as the `summary` argument — so the projector stays the single per-kind
   definition; the handler body is no longer copied. The
   `TestStreamHandlersDoNotConstructRowsDirectly` guard is satisfied via identifier provenance
   (`row := summary(...)` then pass `row`), the form `rowArgIsApproved` already allows.
   NOT converted (genuinely different — extra fanout / event-diffing): handleService,
   handleEndpointSlice(+Event), handleConfigMap/Secret(+Event, helm refresh), handleHPA(+Event,
   workload fanout), handleCustomResource*/CRD.

   **object-map `collect*` (30) — converted to a generic body (2026-06-14, gate-green).**
   The 22 informer-lister + 8 gateway-client collectors collapsed onto one generic
   `collectKind[T metav1.Object](idx, group,version,kind,resource, list func()([]T,error), fill func(T,*objectMapRecord))`
   that does list → skip → loop and builds the four common record fields (ref, timestamp,
   owners, labels); a per-kind `fill` closure sets only the parts that genuinely differ —
   status projection, optional action facts, and the typed record field. The helpers
   `refFromObject`/`objectCreationTimestamp` were widened to the `metav1.Object` interface so
   the generic passes the item directly; gateway value-slices adapt via `ptrsOf`. The
   `objectMapRecord` typed fields stay (they ARE purpose-specific — full object vs pod
   `template`-only for workloads vs nothing for cm/secret/sa/node — and the relationship
   resolver reads them per-kind), but that per-kind variation now lives in the small typed
   `fill` closures, not in 30 copies of the list/loop/record boilerplate. `object_map.go`
   −154 net lines. `collectHPAs` stays hand-written (documented one-off: live v2 LIST +
   `hpaListed` flag + `client==nil` guard).

   **`Build*Summary` (9): not duplication.** These are the single typed per-kind projection
   definitions; `streamObjectRow` now consumes them via its `summary` parameter rather than
   re-deriving rows. `App.Get<Kind>` stays hand-written (Wails type anchors).

   **Codegen (plan option a) deferred, not needed.** The cleanly-convertible families are all
   done via generics/tables without introducing a new build mechanism. What remains per-kind
   (object-map edge logic, `Build*Summary`, `App.Get<Kind>`) is irreducible typed binding, not
   copied boilerplate, so codegen would relocate explicit code without removing real drift risk.
4. **Expand** subsystem by subsystem, carrying the verified per-kind overrides.
5. **Frontend** `Ns*/Cluster*` view layer last (separate review bar; UI-behaviour risk).

## Risks / de-risking

- Blast radius (every subsystem + frontend + cross-layer): mitigated by phasing +
  golden-file equivalence checks per subsystem.
- Over-abstraction: codegen-from-descriptor keeps output explicit; reject a mega-registry
  that is harder to read than the duplication it removes.
- It single-sources and kills drift; it does not zero out line count (typed glue moves
  into generated code).

## Validation

`mage qc:prerelease` at each phase; golden-file checks for every generated table;
regenerate Wails bindings and diff `models.ts` for any DTO-touching phase.
