# Large-Scale Refactor Opportunities (validated candidates)

**Status:** Validated by direct code inspection on 2026-06-18. Nothing here is committed. This is
input to a design/grilling session before any candidate is promoted to a real plan.

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
bottom). What remains below are the **three candidates that survived validation**. The headline
finding: the team has _already_ applied the centralization pattern across most of the codebase, so
the surviving work is largely "last-mile holdout adoption," not greenfield consolidation.

`[verified]` = confirmed by direct inspection on 2026-06-18.

---

## Bottom line

- **Only ONE survivor is genuinely a _very large-scale_ refactor: X1 (frontend rendering
  registry)** — and it is _qualified_: a real ~45–50% boilerplate collapse, but a ~20–30%
  irreducible per-kind widget tail and a real per-kind-DTO design problem. Solid, not
  transformative.
- **X2 (~8h) and F3 (~3–4h) are CONFIRMED but medium/small** — applying a pattern already proven
  elsewhere to the remaining holdout sites. Worth doing; not the scale of the prior two refactors.
- **Pattern-adoption theme:** X2 and F3 (and the dismissed-but-real F1) all share one shape — a
  good pattern exists and one or two holdouts haven't adopted it. Bundling them is a small-PR
  sweep, not one coherent refactor.

| ID | Candidate | Verdict | Confidence | True scope |
|----|-----------|---------|-----------|------------|
| **X1** | Frontend rendering registry | **CONFIRMED (qualified)** | High | Large. ~45–50% collapse, ~20–30% irreducible tail. ⭐ only true large-scale candidate |
| **X2** | Refresh scope/lifecycle unification | **CONFIRMED (partly solved)** | High | Medium (~8h). Object panel already centralized; cluster + namespace are holdouts |
| **F3** | Async data state union | **CONFIRMED (narrow)** | Med-High | ~3–4h. Only LogViewer/NodeLogsTab; other tabs already use the snapshot union |

---

## Do NOT duplicate — already done, in flight, or deliberately deferred

- **Resource-kind registry** — largely complete; remaining items are sanctioned exceptions. See
  `docs/architecture/resource-kind-registry.md`.
- **View-owned live-window fetch** — `docs/plans/deferred/view-owned-window-fetch.md`. The
  highest-priority _planned_ refresh-layer refactor; deferred to a focused pass. X2 touches
  adjacent code.
- **Large-data Track B (persistent SQLite catalog store)** — evidence-triggered; do not start
  until a 100k+-object cluster reports Browse/Custom degradation.
- **Large-data review follow-ups F1–F3** — trigger-gated / debt-driven.

---

## X1 — Frontend rendering registry (close the registry loop) ⭐ only true large-scale candidate

**Promoted to a plan:** design resolved and sequenced in
[`docs/plans/x1-frontend-rendering-registry.md`](./x1-frontend-rendering-registry.md)
(Architecture A + drift-check; scope includes collapsing the data-plumbing).

**Verdict: CONFIRMED, but qualified. Confidence: High.** The duplication is real and the fix is
feasible, but the payoff is smaller and the design harder than recon implied.

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

**Verdict: CONFIRMED, but the hard part is already solved. Confidence: High. Scope: medium (~8h).**

**What validation found:**

- **Object panel is already centralized** — all 7 scopes computed once in `getObjectPanelScopes()`
  (`objectPanelRef.ts`); a comment documents this was a deliberate fix for a prior drift bug
  `[verified]`. The _pattern is proven_; X2 is "apply it to the other two surfaces."
- **Cluster views** (`ClusterResourcesContext.tsx`) compute scopes in one place but consume them via
  three patterns (active-domain lifecycle hook, a manual cleanup-all effect, six individual handles)
  — two scope-acquisition paths that can drift `[verified]`.
- **Namespace views** (`NsResourcesContext.tsx`) repeat `normalizeNamespaceScope(namespace, clusterId)`
  in ~11 resource hooks — change the derivation and all 11 must update `[verified]`.
- Backend SSE-handler dedup (the "minor half") is genuinely minor — only
  `refresh_aggregate_eventstream.go` is large.

**Fix shape.** Extract a per-view domain manifest (`domain → computeScope(ref)`) + one
scope-derivation hook for cluster and one for namespace, mirroring the object-panel pattern. Kills
the ~11× namespace duplication and the dual cluster paths.

**Risk: Med.** Touches the critical cleanup-all effect on the cluster surface. Overlaps
view-owned-window-fetch; sequence with it.

---

## F3 — Async data state union

**Verdict: CONFIRMED, narrow. Confidence: Med-High. Scope: ~3–4h.**

Most tabs are already fine: EventsTab/MapTab/YamlTab consume the refresh-store snapshot, which is
**already a discriminated union** (`status: idle|loading|initialising|updating|error`); ShellTab uses
its own `status` union `[verified]`. The genuine flag-soup is confined to `LogViewer` (and
`NodeLogsTab`, which reuses it): `LogViewerState` carries ~6 overlapping booleans that can represent
contradictory states `[verified]`.

**Fix shape.** Redefine `LogViewerState` with a discriminated async union — but **batch it with the
make-impossible-states effort** rather than doing it in isolation.

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
- **F1 — Object-panel action dispatcher — OVERSTATED (narrow, but real).** `useObjectActionController`
  already ships in 15+ surfaces; ObjectPanel is the lone holdout running a parallel reducer + ~19
  action props. Residual (~4–6h): delete the reducer, wire ObjectPanel to the controller, collapse
  the `DetailsTab` prop signature. Watch: ObjectPanel owns "close modal on resource-deleted."
- **F2 — Table config schema — INVALID.** The shared layer already exists
  (`useGridTablePersistence` + `useGridTableBinding` + `useResourceGridTableCommon`); the three
  public grid hooks are intentional thin wrappers. No refactor needed.

---

## Recommendation

Three honest paths:

1. **Grill X1 (frontend rendering registry)** — the only candidate at the scale of the prior two
   refactors. Accept up front that the payoff is a ~45–50% boilerplate collapse + one rendering
   chokepoint (not 90%), with a real per-kind-DTO/codegen design question to resolve.
2. **Do the pattern-adoption sweep** — X2 (~8h) + F3 (~3–4h) + the dismissed-but-real F1 (~4–6h) as
   small, low-risk PRs retiring the last holdouts of patterns already proven elsewhere.
3. **Conclude there is no clean large-scale refactor right now** — the codebase is already
   well-consolidated; bank the validation and revisit when new duplication accrues.

**Open decision:** which path — and if X1, whether its qualified payoff justifies a high-effort,
high-risk, user-visible refactor.
