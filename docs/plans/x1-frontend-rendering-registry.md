# Plan: X1 — Frontend rendering registry (descriptor-driven Overview/Details)

**Status:** Planned, not started. Promoted from `docs/plans/refactor-opportunities.md` (X1) after
validation + a design pass on 2026-06-18/19.

**One-liner:** Replace the ~16 hand-written per-kind Overview components and the per-kind
data-plumbing (`objectDetailModel.ts`'s 40-case `switch` + 42-field `DetailSlots` union +
`overviewRegistry`) with a single per-kind **descriptor** that drives a generic
`<OverviewRenderer>`, a generic derivation chokepoint, and a runtime drift-check — so adding or
changing a kind's Details surface is one descriptor edit, not edits across 4 files.

This is **Architecture A** (frontend-owned presentation): the Wails-codegen'd per-kind DTOs stay
the data contract; presentation stays in the view layer. We are **not** pushing UI vocabulary into
Go. The backend↔frontend loop is already closed at the data boundary (the generated `*Details`
classes); this closes the *frontend's own* per-kind duplication.

## Why (validated)

- ~16 Overview components, ~5,956 production LOC; ~40–50% pure boilerplate, ~35–40%
  schema-expressible rows, ~15–25% irreducible per-kind widgets. Realistic collapse
  ~5,400 → ~2,700 LOC plus one rendering chokepoint. `[verified 2026-06-18]`
- Three parallel per-kind dispatch tables already exist on the frontend data side
  (`buildDetailSlots` switch, `DetailSlots`, `overviewRegistry`) plus the components — four places
  to touch per kind today.
- Multi-kind components branch on kind 3–13× each (RBAC 13, Workload 7, Storage 3); `GatewayAPI`
  selects by which `*Details` prop is non-null (6 independent sub-renderers). That branching is the
  duplication a per-kind schema deletes. `[verified 2026-06-19]`

## Design decisions (and the rule that forces each)

1. **Architecture A + drift-check test.** Presentation is a view concern; loop is already closed at
   the data boundary. Drift handled by a test, not by relocating logic to Go.
   *(simplest complete+correct; difficult-but-correct over the data-only loop closure)*
2. **Key-based field refs.** Schema fields reference the DTO by key (`field: keyof DTO`), not opaque
   lambdas, so the drift-check can verify coverage. Computed values declare `derivedFrom: [...]`;
   widgets declare `consumes: [...]`. *(makes the drift-check sound)*
3. **One unified per-kind descriptor** `{ class, schema, capabilities, masksValues?, widgets }`,
   co-located in the kind's own file. Collapses `overviewRegistry` + `buildDetailSlots` switch +
   `DetailSlots`. *(don't leave per-kind tables; match backend per-kind co-location)*
4. **Renderer owns the frame.** `<OverviewRenderer>` renders `ResourceHeader` / `ResourceStatus` /
   `ResourceMetadata` / `LabelsAndAnnotations` from the DTO; schemas describe only the
   kind-specific middle. *(where the boilerplate collapse comes from)*
5. **Per-kind schemas composed from shared fragments; no `kind===` in any schema.** Each kind has
   its own schema built by spreading exported fragments. *(deletes the 3–13 branch sites instead of
   relocating them)*
6. **Derived fields via a field-presence chokepoint.** One `buildDerived(dto, descriptor)` keyed off
   `'field' in dto` (`'rules' in dto`, `'containers' in dto`, `'desiredReplicas' in dto`, `'pods' in
   dto`, `'data' in dto`, `'suspend' in dto`, container/service ports for port-forward), with a
   single `masksValues` descriptor flag for Secret vs ConfigMap. No per-kind switch survives.
   *(generic over resource-specific; fix the generic mechanism at a chokepoint)*
7. **`DetailsTab` stays a generic composition** of Overview + Utilization + Containers + RBACRules +
   DataSection, each gated by a derived field. No per-kind branching anywhere in the Details tree.
8. **Drift-check coverage set** for a kind = schema field keys ∪ widget `consumes` ∪
   derivation-consumed keys ∪ frame keys ∪ explicit per-kind `hidden` allowlist; asserted against
   `Object.keys(new Class({}))`. Unreferenced field ⇒ test fails naming the field + kind.

## Target architecture

```
descriptor (per kind, co-located)
  ├─ class: DeploymentDetails            // the Wails-generated DTO class (data contract)
  ├─ capabilities: {delete,restart,...}  // moved from overviewRegistry
  ├─ masksValues?: true                  // only Secret
  ├─ schema: OverviewSchema<DTO>         // sections → fields (key-based) + widget slots
  └─ widgets: { PodStateBar, ... }       // escape hatches; declare `consumes`

registry: Map<kind, descriptor>          // replaces overviewRegistry + buildDetailSlots switch

ObjectPanel
  → registry.get(kind).class(payload)    // generic DTO build (no 40-case switch)
  → buildDerived(dto, descriptor)        // field-presence chokepoint (no switch)
  → DetailsTab (generic composition)
       → <OverviewRenderer schema data /> // frame + fields + widgets
       → Containers/RBACRules/DataSection/Utilization (gated by derived fields)

drift-check test: for each kind, coverage-set == Object.keys(new class({}))
```

**Initial schema primitive set** (extend only when a component needs it): `text`, `chip`/`badge`
(+`tooltip`), `link`/`links` (ResourceLink/ObjectPanelLink), `keyValueMap` (labels/selector/
nodeSelector), `list` (string[]), `countWithTooltip`, `age`/`timestamp`, `code`/`mono`, and
`widget` (escape hatch). Every field supports `hidden: (dto) => boolean` to preserve quiet-filtering
(hidden-when-empty; no layout jitter).

## Files affected

- New: `Overview/OverviewRenderer.tsx`, `Overview/schema.ts` (types + fragment helpers),
  `Overview/derive.ts` (the chokepoint), `Overview/registry.ts` (rewritten to descriptors),
  per-kind `Overview/schemas/<kind>.ts`, `Overview/driftCheck.test.ts`.
- Rewritten: `objectDetailModel.ts` (switch + `DetailSlots` removed; generic build + `buildDerived`).
- Trimmed: each `XOverview.tsx` → schema (+ widget file for the irreducible ~25%).
- Touched seams: `DetailsTab.tsx`, `useOverviewData.ts`, `useUtilizationData.ts`, `index.tsx`
  (the wrapper keeps HPA detection / node-maintenance / ActionsMenu — that's panel chrome, not
  per-kind rendering).

## Phased plan (red/green/refactor TDD; one behaviour at a time)

- **P0 — Renderer + schema types + drift-check harness. ✅ (2026-06-19)** Built `schema.ts`
  (`OverviewDescriptor`/`OverviewSchema` + `coverageKeys` + `FRAME_FIELDS`), `OverviewRenderer.tsx`
  (frame-owning, no per-kind logic), `descriptors/configmap.tsx`, and `driftCheck.test.ts`.
  Red proven: with `coveredElsewhere` empty the check failed naming `[details, data, binaryData,
  dataCount]`; green after declaring them (data/binaryData → DataSection; details/dataCount
  unshown). ConfigMap migrated to a thin wrapper; existing `ConfigMapOverview.test.tsx` stayed green
  (parity oracle). `tsc --noEmit` 0 errors; eslint clean; 13/13 tests pass. Full `mage qc:prerelease`
  not yet run (appropriate at the X1 reporting boundary, not per-phase).
- **P1 — Derivation chokepoint. ✅ (2026-06-19)** Replaced the 40-case `buildDetailSlots` switch
  with a single `DETAIL_KIND_CONFIG` map and routed the derivation gates through it. **Design
  correction:** pure field-presence would regress — `rules` is overloaded (Ingress/Route/Webhook vs
  RBAC), `containers` exists on Job (excluded), `desiredReplicas` on HPA (not scalable), `pods` on
  Node — so the chokepoint is **capability-gated**, not shape-inferred. Added characterization tests
  locking those four exclusions. `DetailSlots` NOT deleted yet (still consumed by `useOverviewData`/
  `useUtilizationData`; retired in P6). 9/9 objectDetailModel + 244/244 object-panel tests; tsc 0.
- **P2 — Service** (links/ports) to exercise more primitives. **✅ (2026-06-19)** Generalized the
  schema to an ordered item list (`field | status | widget`) with dynamic `label`/`fullWidth`,
  `mono`, and `showSelector`; renderer renders header → items → metadata. Service migrated verbatim
  (Type, status item, IP address(es), External IPs, LB IP/Status, External Name, Ports, Endpoints,
  Session Affinity/Timeout, selector); ConfigMap updated to the item shape. 6/6 tests; tsc 0.
  Nested-DTO kinds (config/network) migrate this way; flattened kinds (workload/storage/rbac/policy/
  cluster) need the raw-DTO data-path rewire (P4 prerequisite).
- **P3 data-path rewire — ✅ (2026-06-19).** Added `OverviewContext` (hpaManaged / drain /
  clusterMeta — values not on the DTO) threaded by the renderer; `ObjectDetailModel.activeDetail`
  (raw active DTO); `descriptorRegistry` (kind → descriptor, single source for production dispatch +
  the drift-check); `index.tsx` renders the descriptor from `activeDetail` for registered kinds and
  falls back to `GenericOverview` for the rest. ActionsMenu + Utilization untouched.
- **P3/P4/P5 — ✅ (2026-06-19). All 40 built-in kinds migrated** to descriptors (parallelized,
  integrated + verified centrally): workload family (Deployment/DaemonSet/StatefulSet/ReplicaSet with
  PodStateBar/condition/strategy/volume-template widgets), Job/CronJob (+JobTimeline), Pod, Node
  (drain via context), Storage×3, RBAC×5, Policy×4 (HPA metrics), cluster resources×5, Ingress, Helm,
  EndpointSlice (clusterMeta via context), GatewayAPI×8 (routes share a schema via a factory). Each
  kind's `*Overview.test.tsx` converted to render `OverviewRenderer(descriptor, dto)` as the parity
  oracle; **drift-check green for all 40 kinds.**
- **P6 — Cleanup ✅ (2026-06-19).** Deleted the 16 legacy per-kind Overview components; slimmed
  `registry.ts` to the `GenericOverview` fallback + `getResourceCapabilities`; trimmed
  `registry.test.tsx`.
- **P7 — Data-plumbing collapse ✅ (2026-06-19).** Eliminated the 42-field `DetailSlots` union and
  deleted `useOverviewData` (835 LOC). `objectDetailModel` now exposes `activeDetail` (raw DTO) +
  derived fields, all gated by `DETAIL_KIND_CONFIG` capability flags. Consumers rewired:
  `useUtilizationData` takes the active DTO; `DetailsTab` sources the Overview props from
  `objectData` + the model; `index.tsx` builds the ActionsMenu actionObject from those; the
  custom-resource `GenericOverview` fallback is fed `objectData`; `ObjectPanelContent` reads the
  CronJob jobs from `activeDetail`. `DetailsTab.test` rewritten to the composition contract (per-kind
  field rendering already covered by descriptor tests + drift-check). **`mage qc:preRelease` passes
  (exit 0): gofmt, go vet, staticcheck, Go race tests, prettier, eslint, typecheck, 3270 frontend
  tests, knip, trivy.**

## Status: COMPLETE (2026-06-19)

All 40 built-in kinds render via the descriptor registry + generic `OverviewRenderer`; custom
resources use the `GenericOverview` fallback. The runtime drift-check guards DTO-field coverage for
every kind. The per-kind data-plumbing is fully collapsed: the `buildDetailSlots` switch, the
42-field `DetailSlots` union, and `useOverviewData` (the per-kind flattening hook) are all gone —
`objectDetailModel` exposes a single `activeDetail` + capability-gated derivations. Full
`mage qc:preRelease` is green (exit 0). Nothing deferred.

## Risks / open implementation-time verifications

- **Schema must not out-complicate the duplication.** If a kind reads worse as a schema, keep it a
  widget. Gauge per phase.
- **`'field' in dto` relies on the generated class defining exactly that kind's fields** (true for
  Wails gen; verified for DeploymentDetails). The drift-check partly guards this.
- **Verify the frame fields** (name/namespace/kind/status*/labels/annotations) exist on every
  `*Details` DTO before letting the renderer own the frame (verified for Deployment).
- **`useOverviewData` / `useUtilizationData` read `model.slots`** — repoint to the active DTO +
  derived fields; not yet read in full.
- Preserve quiet-filtering and the resource-deleted / loading-overlay behaviour in `DetailsTab`.
