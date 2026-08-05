---
name: app-review
description: Audit broad Luxury Yacht systems or cross-cutting concerns for structural simplification, hardening, optimization, or refactoring; use for app-wide reviews and phased structural plans, not branch readiness or narrow bug scans
---

# App Review

Audit whole systems deeply enough to identify changes that remove a class of
correctness, stability, consistency, performance, or development problems.
Start read-only unless the user explicitly requests planning or implementation.

## Start

1. Use `.agents/README.md` only if the requested domain is ambiguous.
2. Inspect read-only repository state:
   - `git status --short`
   - `git branch --show-current`
   - `git diff --stat`
   - `git ls-files --others --exclude-standard`
3. Name the review domains before judging candidates.
4. Inventory each domain across producers, consumers, tests, docs, and relevant
   runtime paths. Use the narrow workflow skill only when deeper rules are
   needed.
5. Before proposing structural opportunities, read the
   [settled findings](references/settled-findings.md) and reject candidates already consolidated,
   dismissed, or trigger-gated unless current evidence overturns that verdict.

Do not reread injected `AGENTS.md` files. Open owning architecture docs only
after the domain is chosen.

## Review questions

For each domain, determine:

- every representation and owner of the state or contract;
- producer/consumer ordering and boundary validation;
- parallel implementations, compatibility branches, or duplicated definitions;
- failure modes involving identity, freshness, lifecycle, permissions, teardown,
  or diagnostics;
- whether tests prove the system contract or only local behavior; and
- how many files, call sites, registrations, or user surfaces carry the pattern.

Prioritize correctness and data-safety risks, then cross-layer drift,
simplification, app-wide pattern drift, and developer friction. Drop candidates
supported only by one local example, naming/style preferences, or speculative
rewrites.

## Evidence required for each finding

Prove:

1. current behavior or structure with file references across the surface;
2. breadth with counts or an explicit inventory;
3. the concrete failure mode or recurring cost;
4. what the proposed change removes, centralizes, or makes explicit; and
5. the regression tests, diagnostics, docs, and skills affected.

## Output

When the user requests three areas, return exactly three ranked system-level
areas. For each, state the review domain, problem, impact, improvement direction,
evidence, and likely validation. Rank the most important by user-facing safety,
breadth, frequency of change, bug-class removal, and whether it unlocks other
work.

Answer follow-up questions from gathered evidence and narrow architectural
intent before implementation.

## Plans and implementation

When the user requests a plan:

- write one temporary `docs/plans/<topic>.md` per independent area, or one plan
  for tightly coupled areas;
- include target model, non-goals, inventory, phased `[ ]` checklist, open
  questions, and validation;
- keep temporary plans out of durable indexes; and
- move lasting contracts into owning docs/skills before removing a finished
  plan.

When implementation is authorized, work in dependency order, keep the plan
current, and follow the root TDD and validation contracts. Documentation-only
work must at least pass `git diff --check`.

## Boundaries

- Use `branch-review` for merge readiness.
- Do not use this workflow for a narrow bug or one-package improvement scan.
- Do not delegate unless the user explicitly requests parallel agents.
- Do not implement during an initial read-only review.
