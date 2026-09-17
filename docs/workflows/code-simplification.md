# Systematic code simplification

Use this workflow for a repository-wide simplification effort. A request scoped
to one change or subsystem stays within that scope. The
[code-simplification skill](../../.agents/skills/code-simplification/SKILL.md)
owns behavior preservation; the
[app-review skill](../../.agents/skills/app-review/SKILL.md) owns structural
investigation. This workflow owns coverage of the repository across passes.

## Inventory before selection

Keep one active ledger under `docs/plans/` with the baseline revision, inventory
rules, review units, candidate queue, and pass results. Inventory backend,
frontend, shared libraries, native/platform code, generators, and build tooling.
Account separately for generated output, tests, fixtures, configuration, docs,
and assets. Inspect these with their producer or owning workflow; do not mistake
generated repetition for handwritten duplication.

A review unit is an owner, package, component family, or workflow. File buckets
are starting points, not architecture claims. Split a large bucket into named
responsibilities before reviewing it. Follow a contract across directory and
language boundaries instead of treating backend and frontend as separate apps.

Every unit starts `inventoried`, not `reviewed`. Record exactly which files,
consumers, and contracts were inspected. A local refactor does not close its
containing subsystem. Add new and previously missed files at the next pass;
preserve the existing review history when the inventory changes.

## Choose the next pass

Maintain an explicit rotation through the review domains. Visit each domain
before starting another cycle. A discovered correctness problem may interrupt
the rotation; record why and return to the interrupted domain afterwards.
Recent changes are a tie-breaker, not the scope boundary. Include quiet code
and units with no complexity warnings.

Within the next domain, investigate candidates in this order:

1. Shared ownership or duplicated policy that makes several consumers reason
   about the same contract independently.
2. State transitions, error handling, or orchestration that obscure ordering
   and make routine changes difficult to assess.
3. Repeated transformations or competing representations of the same data.
4. Local control flow and naming that materially obstruct comprehension.

For each candidate record reach, recurring maintenance cost, expected
simplification, behavior risk, available evidence, and validation effort. Use
qualitative judgments with evidence; do not manufacture a weighted score.
Complexity, file size, churn, and dependency counts locate questions. They do
not establish a defect or justify extracting a helper. Keep Go/Biome results
separate and follow the [Sonar contract](../frontend/sonar.md).

Check the [settled findings](../../.agents/skills/app-review/references/settled-findings.md)
before re-proposing a consolidation. Record rejected candidates and the evidence
or future trigger that would justify revisiting them.

## One pass

1. Name one responsibility and the files to inspect. Trace its producer,
   consumers, identity, ordering, failure paths, and cleanup. Record dependency
   directions and any cycle risk before proposing a shared owner.
2. State the maintenance problem and a before/after explanation. Name what
   disappears: duplicate policy, unnecessary state, nested orchestration,
   conversions, or indirection. List intentional complexity that must remain.
3. Confirm existing characterization tests. Add missing meaningful cases and
   run them against the current implementation before a behavior-preserving
   refactor. An intended behavior change is separate work and requires the
   repository's red/green/refactor process.
4. Make one cohesive change and rerun focused tests. Existing tests must not
   need weaker assertions to accommodate the refactor. Follow shared owners;
   avoid feature-local exceptions and speculative general frameworks.
5. Review readability and total responsibilities, including new helpers.
   Extracting branches merely to move a complexity score does not qualify.
6. Run the applicable coverage, complexity, runtime, and final checks from the
   [completion contract](completion.md). Inspect formatter changes. Preserve
   failed, blocked, or unrun checks in the ledger; do not close the pass.
7. Record the result, disposition of each candidate, remaining scope, and the
   next domain. Commit or publish only when separately authorized.

## Coverage and stopping rules

Track review coverage separately from implementation and validation:

- Unit: `inventoried` → `reviewing` → `reviewed`, with an explicit inspected scope.
- Candidate: `investigate` → `confirmed` → `implementing` → `validated`.
- Alternatives: `not warranted` with evidence, or `deferred` with a reason and
  re-entry condition. A deferred or blocked change remains outstanding.

A pass may conclude that the current implementation is preferable. Do not
require a change in every file, a deletion quota, or a lower line count. Finish a
review cycle only when all scheduled domains have a recorded disposition; call
the repository review complete only after every inventory unit was inspected.
Neither milestone means all deferred implementation or validation is complete.
Report reviewed units, concrete simplifications, rejected/deferred work, and
validation evidence rather than counting edits as progress.
