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

## First Pass

1. Read `AGENTS.md`, `.agents/README.md`, `.agents/context/code-map.md`, and
   `.agents/context/app-areas.md`.
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
