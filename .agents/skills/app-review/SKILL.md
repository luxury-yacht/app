---
name: app-review
description: Use for large-scale structural Luxury Yacht app reviews that audit broad systems or cross-cutting concerns, identify major simplification, hardening, optimization, or refactoring opportunities, and optionally write temporary phased plans in docs/plans
---

# App Review

Use this when the user asks for a broad structural review of the app,
architecture, frontend, backend, or developer experience and wants large-scale
simplification, optimization, hardening, or refactoring opportunities.

This is not a branch merge-readiness review, not a narrow backend/frontend bug
scan, and not a lightweight sampling exercise. The unit of work is a whole
subsystem or cross-cutting concern. Do not preselect domains from this skill;
derive them from the user's request, current repo evidence, and project risk.

## Goal

Audit broad systems deeply enough to identify major changes that would make the
app significantly more stable, simpler, faster, easier to develop on, or easier
to operate. When the user asks for three areas, produce exactly three
system-level improvement areas. Each area must be grounded in current repo
evidence and include a concrete improvement direction.

## Default Stance

Start read-only unless the user explicitly asks for plans or implementation.
Prefer structural issues that repeatedly create bugs, unclear ownership,
duplicated contracts, fragile lifecycle behavior, inconsistent app-wide
patterns, weak validation boundaries, or excessive development drag.

Do not start by hunting for isolated findings. Start by choosing review domains
and building inventories for them.

## Already Settled (do not re-propose without new evidence)

A 2026-06 large-scale structural-refactor validation pass investigated ten
candidates and resolved all live ones; its temporary plan
(`docs/plans/refactor-opportunities.md`) was deleted after completion. Before
proposing any of the following as a "new" opportunity, you must cite concrete new
evidence that overturns the recorded verdict.

**Already consolidated (done — re-proposing is duplicate work):**

- Frontend object-panel Overview rendering → one per-kind descriptor registry
  driving a generic `<OverviewRenderer>` + runtime drift-check
  (`docs/frontend/component-structure.md` → "Object-panel Overview rendering").
- Object-panel actions → shared `useObjectActionController` (no panel-local
  action reducer); see `.agents/skills/object-panel/SKILL.md`.
- Cluster-view refresh scopes → single `clusterDomainScopes` manifest in
  `frontend/src/modules/cluster/contexts/ClusterResourcesContext.tsx`.
- LogViewer async/loading flags → discriminated `LogViewMode` union in
  `frontend/src/modules/object-panel/components/ObjectPanel/Logs/logViewerReducer.ts`.
- Resource-kind registry drives object-catalog, table rows, detail dispatch
  (codegen), object-map, and stream summaries
  (`docs/architecture/resource-kind-registry.md`; remaining items are sanctioned
  exceptions).

**Investigated and dismissed (do not re-validate without new evidence):**

- Snapshot query consolidation — INVALID. One query engine
  (`typed_table_query.go`); `static_table_query.go` is thin adapters with ~0%
  logical overlap. Only micro-wins (shared numeric CPU/memory/age sort helpers;
  the namespaced-vs-cluster event adapters are ~80% shared).
- App concurrency model — non-issue. The App mutexes are independent with no real
  nested locking (`TestRunSelectionMutationDoesNotHoldKubeconfigChangeLockAcrossCallback`).
- Cluster lifecycle state machine — already centralized in `cluster_lifecycle.go`.
  Residual only: fold a few inline `authManager.IsValid()` checks into reading
  lifecycle state.
- Context & cancellation hub — the multiple context hierarchies are intentional
  and the `context.Background()` fallbacks mostly legitimate. Residual only:
  cancel in-flight async recovery/catalog callbacks at shutdown.
- Permission caching unification — SSAR (per-verb bool), SSRR (rules blob), and
  the response-cache (transient GET dedupe) are genuinely different; merging
  breaks the SSRR consumer. Residual (~2h): dedup the shared background-refresh
  boilerplate only.
- Table config schema — INVALID. The shared layer already exists
  (`useGridTablePersistence` + `useGridTableBinding` + `useResourceGridTableCommon`);
  the three public grid hooks are intentional thin wrappers.
- Namespace-view scope unification — INVALID. `normalizeNamespaceScope` in
  `NsResourcesContext.tsx` has 2 call sites (not ~11); there is no duplication
  worth a refactor.

**Deferred / trigger-gated (not current work):**

- View-owned live-window fetch — `docs/plans/deferred/view-owned-window-fetch.md`
  (the highest-priority planned refresh-layer refactor).
- Large-data persistent SQLite catalog store — evidence-triggered; start only if
  a 100k+-object cluster reports Browse/Custom degradation.

## First Pass

1. Read `AGENTS.md`, `.agents/README.md`, `.agents/context/code-map.md`, and
   `.agents/context/app-areas.md`, plus the "Already Settled" list above.
2. Check repository state with read-only git commands:
   - `git status --short`
   - `git branch --show-current`
   - `git diff --stat`
   - `git ls-files --others --exclude-standard`
3. Identify review domains before judging findings. If the user named domains,
   use those. Otherwise choose broad systems or concerns from
   `.agents/context/app-areas.md`, `docs/README.md`, and current repo evidence.
4. Use narrower skills only when a review domain needs deeper inspection:
   `refresh-subsystem`, `cluster-auth-lifecycle`, `browse-tables`,
   `object-panel`, `object-map`, `permissions-capabilities`,
   `operations-workflows`, `app-shell`, or `shared-resource-model`.

## Review Domain Inventory

For each review domain, build an inventory before proposing improvements. Use
`rg`, `rg --files`, import searches, tests, docs, and representative call
graphs. The inventory should be broad enough that the conclusion is about the
system, not one file.

## Structural Questions

Ask these for every review domain:

- What are all the ways this system is represented?
- Where is ownership split across backend, frontend, docs, tests, or skills?
- Where does adding a feature require touching too many places?
- Where are there parallel paths that should be one path?
- Where are compatibility branches or flags preserving an old model?
- Where can stale state, identity loss, lifecycle races, permission ambiguity,
  or diagnostics gaps appear?
- Which tests prove the app-wide contract, and which only preserve local
  behavior?

## What To Look For

Prioritize findings in this order:

1. **Correctness and stability risks**: race-prone lifecycle, stale cache/state,
   missing cluster identity, weak teardown, error swallowing, partial failure
   ambiguity, or fragile stream/snapshot recovery.
2. **Cross-layer contract drift**: backend/frontend shape mismatches, duplicate
   domain definitions, diagnostics gaps, stale docs, or tests that preserve old
   behavior.
3. **Simplification opportunities**: duplicated code paths, merge layers,
   compatibility branches, overly broad abstractions, or flags that exist only
   because ownership is unclear.
4. **App-wide pattern drift**: multiple competing patterns for the same job,
   repeated local implementations, inconsistent diagnostics, or subsystem rules
   that are documented differently in different places.
5. **Developer experience**: hard-to-test modules, large mixed-responsibility
   files, unclear registration points, brittle manual update steps, or missing
   local validation guidance.

Do not present issues that are only naming, formatting, comments, or speculative
rewrites without a concrete failure mode.

## Evidence Standard

For each review domain and final improvement area, prove:

- What the system currently does, with file references across the relevant
  surface.
- How broad the pattern is: approximate file counts, key directories, repeated
  call sites, or registration points.
- Why the current structure creates instability, performance cost,
  inconsistency, or development drag.
- What a correct fix would remove, centralize, harden, or make explicit.
- What tests, diagnostics, docs, or skills would need to change.

If the evidence is only local, keep investigating or drop the candidate.

## Review Output

When the user asks for three areas, return exactly three system-level areas,
ranked by importance:

```markdown
1. **Area name**
   Review domain: ...
   Problem: ...
   Why it matters: ...
   Improve by: ...
   Evidence: `path/file.ext`, `path/other.ext`, plus inventory summary
   Likely validation: ...
```

Phrase areas as app/system problems, not file/package problems. Specific files
are evidence for the area, not the area itself.

After the three areas, answer which one is most important using this rubric:

- User-facing correctness or data safety impact.
- Breadth of the pattern across the app.
- How often the weak contract or pattern is touched by normal development.
- Whether the fix removes a class of bugs instead of one instance.
- Whether the current structure blocks other planned work.
- Whether the fix simplifies future changes enough to justify the migration.

If the user asks follow-up questions, answer from the evidence and narrow the
plan before implementation. If product or architectural intent is ambiguous,
ask concise questions one at a time when requested.

## Writing Plans

When the user asks to write plans:

1. Create one temporary plan per major area in `docs/plans`, or one combined
   plan if the areas are tightly coupled.
2. Do not add temporary plans to the README or durable architecture indexes.
3. Include:
   - Overview and target model.
   - Non-goals.
   - Inventory of affected systems/files.
   - Phased checklist with `[ ]` items.
   - Open questions.
   - Validation plan.
4. Mark completed work with `[x]` or checked emoji only as phases land.
5. Update the plan continuously during implementation with dated progress notes.

## Implementation Handoff

When the user chooses an area:

1. Re-read the plan and the owning skill/docs.
2. Resolve open questions before code changes.
3. Implement phases in dependency order.
4. Keep the plan current after each phase.
5. For non-documentation work, finish with `mage qc:prerelease`, then inspect
   `git status --short` because the gate may modify files.
6. For documentation-only phases, at minimum run `git diff --check`.

## What Not To Do

- Do not use this skill for branch merge-readiness; use `branch-review`.
- Do not report more or fewer than three major areas unless the user asks for a
  different count.
- Do not rely on lightweight sampling for a structural audit.
- Do not present one-file issues as major app review findings unless they prove
  an app-wide pattern.
- Do not invent missing systems without checking docs and code first.
- Do not write temporary plans into README files.
- Do not start implementation during the initial review unless explicitly asked.
