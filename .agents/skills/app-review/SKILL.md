---
name: app-review
description: Audit broad Luxury Yacht systems or cross-cutting concerns for structural simplification, hardening, optimization, or refactoring; use for app-wide reviews and phased structural plans, not branch readiness or narrow bug scans
---

# App Review

Audit whole systems deeply enough to find changes that remove a class of
correctness, stability, consistency, performance, or development problems.
Stay read-only unless the user explicitly requests planning or implementation.

## Start

1. Inspect repository state read-only: `git status --short`,
   `git branch --show-current`, `git diff --stat`,
   `git ls-files --others --exclude-standard`.
2. Name the review domains before judging candidates; open owning architecture
   docs only after a domain is chosen.
3. Inventory each domain across producers, consumers, tests, docs, and runtime
   paths. Use a narrow workflow skill only when deeper rules are needed.
4. Before proposing structural opportunities, read the
   [settled findings](references/settled-findings.md) and reject candidates
   already consolidated, dismissed, or trigger-gated unless current evidence
   overturns that verdict.

## Review questions

For each domain, determine:

- every representation and owner of the state or contract;
- producer/consumer ordering and boundary validation;
- parallel implementations, compatibility branches, or duplicated definitions;
- failure modes involving identity, freshness, lifecycle, permissions,
  teardown, or diagnostics;
- whether tests prove the system contract or only local behavior; and
- how many files, call sites, registrations, or user surfaces carry the
  pattern.

Prioritize correctness and data-safety risks, then cross-layer drift,
simplification, app-wide pattern drift, and developer friction. Drop candidates
supported only by one local example, naming/style preferences, or speculative
rewrites.

## Evidence per finding

1. Current behavior or structure, with file references across the surface.
2. Breadth, with counts or an explicit inventory.
3. The concrete failure mode or recurring cost.
4. What the change removes, centralizes, or makes explicit.
5. The regression tests, diagnostics, docs, and skills affected.

## Output

When the user requests three areas, return exactly three ranked system-level
areas, each with review domain, problem, impact, improvement direction,
evidence, and likely validation. Rank by user-facing safety, breadth, change
frequency, bug-class removal, and whether it unlocks other work. Answer
follow-ups from gathered evidence and narrow architectural intent before
implementation.

## Plans and implementation

- A requested plan is one temporary `docs/plans/<topic>.md` per independent
  area, or one plan for tightly coupled areas, with target model, non-goals,
  inventory, phased `[ ]` checklist, open questions, and validation. Keep
  temporary plans out of durable indexes.
- Once implementation is authorized, work in dependency order and keep the plan
  current.

## Boundaries

- Use `branch-review` for merge readiness.
- Not for a narrow bug or one-package improvement scan.
- Do not delegate unless the user explicitly requests parallel agents.
- Do not implement during an initial read-only review.
