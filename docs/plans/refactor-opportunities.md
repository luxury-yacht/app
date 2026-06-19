# Large-Scale Refactor Opportunities (validated candidates)

**Status:** Validated by direct code inspection on 2026-06-18; re-validated against current code on
2026-06-19. **X1 is now DONE** (descriptor-driven Overview shipped on `data-driven-overview` — see
`docs/plans/x1-frontend-rendering-registry.md`), so it has moved to the "already done" list below.
Two of the original `[verified]` claims did not survive re-validation (X2 namespace duplication; F3
LogViewer boolean count) and are corrected inline. The remaining live work is X2's cluster-view
half, F1, and a narrow F3.

**Purpose:** Identify the _next_ large-scale refactor, comparable in scope to the two already
done:

- **Resource-kind registry consolidation** — one descriptor registry drives object-catalog,
  table rows, detail dispatch (codegen), object-map, and stream summaries. See
  `docs/architecture/resource-kind-registry.md`. (~90% complete.)
- **Make impossible states impossible** — flag-soup / stringly-typed states converted to
  typed/discriminated representations (port-forward status done; broader effort partial).

**How this list was built.** A recon pass surfaced ten candidates from line-count/grep signals; a
validation pass _read the actual code_ and rendered a verdict on each. The recon pass massively
overstated the opportunity — seven candidates were dismissed (see the tombstone list at the
bottom). Three candidates survived that validation — but **X1 has since shipped**, so the live work
is now X2's cluster-view half, F1, and a narrow F3. The headline finding holds: the team has
_already_ applied the centralization pattern across most of the codebase, so the surviving work is
largely "last-mile holdout adoption," not greenfield consolidation.

`[verified]` = confirmed by direct inspection on 2026-06-18. `[re-validated 2026-06-19]` =
re-checked against current code; corrections noted inline.

---

## Bottom line

- **X1 (frontend rendering registry) — DONE (2026-06-19).** The one genuinely large-scale survivor
  shipped on `data-driven-overview`: descriptor-driven Overview + runtime drift-check, ~45–50%
  boilerplate collapse. See `docs/plans/x1-frontend-rendering-registry.md`. No longer a candidate.
- **F1 — DONE (2026-06-19).** ObjectPanel now runs actions through the shared
  `useObjectActionController` (the parallel `panelReducer` + `useObjectPanelActions` + bespoke modals
  are deleted and the ~21-field `DetailsTab` action signature collapsed to two lifecycle callbacks).
  **X2 (cluster-view half) is the remaining live medium work**; F3 is real but narrow.
- **Pattern-adoption theme:** X2 (cluster), F1, and F3 all share one shape — a good pattern exists
  and one or two holdouts haven't adopted it. Bundling them is a small-PR sweep, not one coherent
  refactor.
- **Two corrections from re-validation `[2026-06-19]`:** X2's _namespace_ half rests on a
  duplication count that isn't real (`normalizeNamespaceScope` has 2 call sites, not ~11) — drop or
  re-scope it. F3's LogViewer "flag soup" is ~3–4 async/loading booleans amid independent user
  prefs, not ~6 contradictory ones.

| ID | Candidate | Verdict | Confidence | True scope |
|----|-----------|---------|-----------|------------|
| **X1** | Frontend rendering registry | **✅ DONE (2026-06-19)** | — | Shipped on `data-driven-overview`. See `x1-frontend-rendering-registry.md`. |
| **X2** | Refresh scope/lifecycle unification | **CONFIRMED — cluster half only** | High | Medium. Object panel already centralized; **cluster** views are the real holdout. **Namespace half invalid** (see X2 below). |
| **F1** | Object-panel action-controller adoption | **✅ DONE (2026-06-19)** | — | ObjectPanel now uses the shared controller; parallel reducer + ~21-prop `DetailsTab` action signature removed. |
| **F3** | Async data state union | **CONFIRMED (narrow)** | Med-High | ~3–4h. Only LogViewer/NodeLogsTab; other tabs already use the snapshot/Shell unions. Scope smaller than first stated. |

---

## Do NOT duplicate — already done, in flight, or deliberately deferred

- **X1 — Frontend rendering registry — DONE (2026-06-19).** Descriptor-driven Overview + runtime
  drift-check shipped on `data-driven-overview`; the ~16 per-kind Overview components and the
  `useOverviewData`/`DetailSlots` data-plumbing are deleted. See
  `docs/plans/x1-frontend-rendering-registry.md`.
- **F1 — Object-panel action-controller adoption — DONE (2026-06-19).** ObjectPanel actions now run
  through the shared `useObjectActionController` (via ActionsMenu); the parallel `panelReducer`,
  `useObjectPanelActions`, and bespoke confirmation/scale/rollback modals are deleted, and the
  `DetailsTab` action prop signature collapsed to `onAfterDelete`/`onAfterAction`.
- **Resource-kind registry** — largely complete; remaining items are sanctioned exceptions. See
  `docs/architecture/resource-kind-registry.md`.
- **View-owned live-window fetch** — `docs/plans/deferred/view-owned-window-fetch.md`. The
  highest-priority _planned_ refresh-layer refactor; deferred to a focused pass. X2 touches
  adjacent code.
- **Large-data Track B (persistent SQLite catalog store)** — evidence-triggered; do not start
  until a 100k+-object cluster reports Browse/Custom degradation.
- **Large-data review follow-ups F1–F3** — trigger-gated / debt-driven.

---

## X1 — Frontend rendering registry (close the registry loop) — ✅ DONE (2026-06-19)

**Status: COMPLETE.** Shipped on `data-driven-overview`: per-kind descriptors drive a generic
`<OverviewRenderer>`, a runtime drift-check guards DTO-field coverage, and the per-kind
data-plumbing (`useOverviewData`, the `DetailSlots` union, the `buildDetailSlots` switch) is
deleted. See [`docs/plans/x1-frontend-rendering-registry.md`](./x1-frontend-rendering-registry.md).
The analysis below is retained as the historical validation record.

**Verdict (original): CONFIRMED, but qualified. Confidence: High.** The duplication was real and the
fix feasible, but the payoff was smaller and the design harder than recon implied.

**Problem.** The backend resource-kind registry drives backend dispatch from one descriptor, but
the **frontend rendering layer was never consolidated**. The object panel hand-writes ~16 per-kind
Overview components plus per-kind Detail wiring.

**What validation found (read the actual components):**

- **~40–50% is pure boilerplate** identical across components: `ResourceHeader`/`ResourceStatus`/
  `ResourceMetadata`, the `useObjectPanel()` + `clusterMeta` preamble copy-pasted in ~14
  components, `normalizedKind` + `if (normalizedKind === 'deployment')` chains `[verified]`.
- **~35–40% is schema-expressible** label→value rows (`ServiceOverview` lines 82–135 are 100%
  declarative; PVC/RBAC/Pod sections likewise) `[verified]`.
- **~15–25% is genuinely irreducible per-kind logic** that resists a declarative schema:
  `WorkloadOverview` `PodStateBar` (~80 LOC) + Deployment condition parsing (~40) + per-kind
  strategy tooltips (~70) + StatefulSet volume templates; `JobOverview` RunSummary + `JobTimeline`
  (~250+ LOC); `PolicyOverview` HPA metric matching (~110); `RBACOverview` subject grouping (~50);
  `GatewayAPIOverview` (561 LOC, bundles 6 kinds, mostly per-kind) `[verified]`.
- **Realistic collapse: ~5,400 → ~2,500–2,800 LOC (~45–50% reduction), NOT 90%.** The escape-hatch
  widgets stay hand-written; the schema moves the maintenance cost, it doesn't erase it.

**The real design problem (biggest blocker).** Each Overview consumes a **per-kind DTO** from the
backend, wired through `objectDetailModel.ts` (`DetailSlots` with ~16 typed DTOs) and dispatched by
`registry.ts` `mapProps`. The backend already codegens detail dispatch (`resource_details_generated.go`,
40+ `GetXDetails` methods), but the **frontend never consumed that registry**. A schema-driven
renderer needs either a parallel per-kind type or a flattened union — and a true "one descriptor
drives both" solution means exporting overview-field descriptors from the backend registry and
codegen-ing the TS, crossing the Wails-generated type boundary `[verified]`.

**Design tree to grill (if chosen):**

1. Runtime hand-written schema per kind vs codegen-from-backend-registry vs hybrid (hand-written +
   codegen drift-check). Trade: coupling vs silent drift.
2. How per-kind exception widgets are expressed (`{type:'widget', component, mapData}`) without the
   schema becoming a second programming language.
3. How far the frontend descriptor couples to the backend registry / DTO shape.
4. Migration order + test-parity strategy across ~16 component test suites.
5. Must preserve quiet-filtering (hidden-when-empty rows; no layout jitter on absent optionals).

**Risk: High.** User-visible surface; test parity across ~16 suites; the abstraction must not be
harder to read than the duplication. The genuine win is a ~45–50% reduction plus a single rendering
chokepoint — weigh that against the effort before committing.

---

## X2 — Refresh scope/lifecycle unification

**Verdict: CONFIRMED for the CLUSTER half only; namespace half INVALID. Confidence: High.**

**What validation found:**

- **Object panel is already centralized** — all 7 scopes computed once in `getObjectPanelScopes()`
  (`objectPanelRef.ts`); the drift-bug comments live in `ObjectPanelContent.tsx` `[verified;
  re-validated 2026-06-19]`. The _pattern is proven_; the work is "apply it to the cluster surface."
- **Cluster views** (`ClusterResourcesContext.tsx`) — the real holdout. Scopes are consumed via
  three patterns: the active-domain lifecycle hook (`useScopedRefreshDomainLifecycle`, ~line 576,
  scope via `getScopeForDomain`), a manual cleanup-all effect (~lines 599–609, scope via raw
  `clusterScope`/`clusterEventsScope`), and six individual resource handles
  (rbac/storage/config/crds/events/custom) — two scope-acquisition paths that can drift `[verified;
  re-validated 2026-06-19]`.
- **Namespace views** (`NsResourcesContext.tsx`) — **claim INVALID `[re-validated 2026-06-19]`.**
  `normalizeNamespaceScope` is defined once and called **twice** (lines 174, 290), not in ~11 hooks
  (8 references repo-wide incl. tests). The ~2× duplication does not justify a refactor; **drop the
  namespace half** or re-justify it on something other than this count.
- Backend SSE-handler dedup (the "minor half") is genuinely minor — only
  `refresh_aggregate_eventstream.go` is large (602 LOC) `[verified; re-validated 2026-06-19]`.

**Fix shape (cluster only).** Extract a per-view domain manifest (`domain → computeScope(ref)`) +
one scope-derivation hook so the active-domain hook, the cleanup-all effect, and the six handles all
read scope from one source. Kills the dual cluster paths.

**Risk: Med.** Touches the critical cleanup-all effect on the cluster surface. Overlaps
view-owned-window-fetch; sequence with it.

---

## F3 — Async data state union

**Verdict: CONFIRMED, narrow — narrower than first stated. Confidence: Med-High. Scope: ~3–4h.**

Most tabs are already fine: EventsTab/MapTab/YamlTab consume the refresh-store snapshot, which is
**already a discriminated union** (`DomainStatus = idle|loading|initialising|updating|ready|error`,
`core/refresh/store.ts`); ShellTab uses its own union (`ShellStatus =
idle|connecting|open|closed|error`, `ShellTab.tsx`) `[verified; re-validated 2026-06-19]`. The
flag-soup is confined to `LogViewer` (and `NodeLogsTab`, which reuses it) — but it is smaller than
recon implied `[re-validated 2026-06-19]`: `LogViewerState` (`logViewerReducer.ts`) has ~11
booleans, of which **most are independent user prefs** (wrapText, showAnsiColors,
highlight/inverse/caseSensitive/regex matches…) that should NOT be unioned. Only ~3–4 are genuine
async/loading flags (`manualRefreshPending`, `fallbackActive`, `isLoadingPreviousContainerLogs`)
that can overlap with the stream-snapshot status.

**Fix shape.** Give LogViewer's ~3–4 async/loading flags a discriminated async union (leave the
user-pref booleans alone) — and **batch it with the make-impossible-states effort** rather than
doing it in isolation.

**Risk: Med.** Tight coupling to the refresh-store snapshot contract; LogViewer's fallback/retry
semantics must not be hidden by a generic union.

---

## Investigated and dismissed (do not re-propose)

These were surfaced by recon and dismissed by reading the code. Recorded so nobody spends another
validation pass on them. Each line is the verdict + the only residual real work, if any.

- **B1 — Snapshot query consolidation — INVALID.** There is one query engine
  (`typed_table_query.go`); `static_table_query.go` is thin adapter constructors with **0% logical
  overlap**. Micro-wins only: share the CPU/memory/age numeric-sort helpers; unify the
  namespaced-vs-cluster event adapters (~80% shared).
- **B2 — App concurrency model — OVERSTATED (non-issue).** The 17 App mutexes are independent; no
  real nested locking; `TestRunSelectionMutationDoesNotHoldKubeconfigChangeLockAcrossCallback`
  proves the one the comment warns about isn't held across its callback. Action: document the
  ordering rationale; do not refactor.
- **B3 — Lifecycle state machine — OVERSTATED (already done).** `clusterLifecycle`
  (`cluster_lifecycle.go`) already provides the state enum + centralized transitions. Residual:
  consolidate a few inline `authManager.IsValid()` checks to read lifecycle state.
- **B4 — Context & cancellation hub — OVERSTATED.** The multiple context hierarchies are
  intentional; the `context.Background()` fallbacks are mostly legitimate. Residual (narrow): track
  + cancel in-flight async recovery/catalog callbacks at shutdown.
- **B5 — Permission caching unification — OVERSTATED.** SSAR (per-verb bool), SSRR (rules blob),
  and response-cache (transient GET dedupe) are genuinely different; merging would break the SSRR
  consumer. Residual (~2h): dedup only the shared background-refresh boilerplate.
- **F1 — Object-panel action dispatcher — ✅ DONE (2026-06-19).** ObjectPanel was the lone holdout
  running a parallel `panelReducer` + `useObjectPanelActions` + bespoke modals + a ~21-field action
  signature on `DetailsTabProps`. Now `ActionsMenu` drives the shared `useObjectActionController`
  with `useDefaultHandlers: true` (execution + permission gating + all modals centralized), and
  ObjectPanel supplies only `onAfterDelete` (close) / `onAfterAction` (refetch). The reducer,
  `useObjectPanelActions`, and the `PanelState`/`PanelAction`/`ResourceAction` types are deleted.
  Resource-deleted lifecycle state stays local (useState). Full `mage qc:prerelease` green.
- **F2 — Table config schema — INVALID.** The shared layer already exists
  (`useGridTablePersistence` + `useGridTableBinding` + `useResourceGridTableCommon`); the three
  public grid hooks are intentional thin wrappers. No refactor needed.

---

## Recommendation

X1 has shipped, so the original "grill X1" path is closed. Two honest paths remain:

1. **Do the pattern-adoption sweep (recommended)** — small, low-risk PRs retiring the last holdouts
   of patterns already proven elsewhere:
   - **F1 — ✅ DONE (2026-06-19)** — ObjectPanel wired to `useObjectActionController`; reducer +
     bespoke modals deleted; `DetailsTab` action signature collapsed.
   - **X2 cluster half** — one scope-derivation source for `ClusterResourcesContext`.
   - **F3 (~3–4h)** — LogViewer async-union, batched with make-impossible-states.
   - **Skip** the X2 namespace half (duplication count invalid).
2. **Conclude there is no clean large-scale refactor right now** — the codebase is already
   well-consolidated; bank the validation and revisit when new duplication accrues.

**Open decision:** run the sweep (F1 first), or bank it.
