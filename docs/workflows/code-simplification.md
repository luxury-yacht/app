# Systematic code simplification

Use this workflow for repository-wide simplification; a request scoped to one
change or subsystem stays in that scope. The
[code-simplification skill](../../.agents/skills/code-simplification/SKILL.md)
owns behavior-preserving technique, the
[app-review skill](../../.agents/skills/app-review/SKILL.md) owns structural
investigation, and this workflow owns repository coverage across passes.

## Inventory

- Keep one concise active ledger under `docs/plans/`: baseline revision,
  inventory rules, review units, candidate queue, and per-pass inspected scope,
  changes, exceptions, validation, and what remains.
- Inventory backend, frontend, shared libraries, native/platform code,
  generators, and build tooling. Track generated output, tests, fixtures,
  configuration, docs, and assets separately and inspect them with their
  producer or owning workflow; generated repetition is not handwritten
  duplication.
- A review unit is an owner, package, component family, or workflow. File
  buckets are starting points, not architecture claims; split large ones into
  named responsibilities. Follow contracts across directory and language
  boundaries.
- Units start `inventoried`. Record exactly which files, consumers, and
  contracts were inspected; a local refactor does not close its containing
  subsystem. Add new or missed files at the next pass, keeping review history.

## Select the next batch

- Rotate explicitly through review domains, visiting each before the next
  cycle. A visit reviews a substantial subsystem scope and collects its
  worthwhile candidates before editing.
- A correctness problem may interrupt the rotation; record why and return.
  Recency is a tie-breaker, not the scope; include quiet code and units with no
  complexity warnings.
- Investigate candidates in this order:
  1. Shared ownership or duplicated policy that makes several consumers reason
     about one contract independently.
  2. State transitions, error handling, or orchestration that obscure ordering.
  3. Repeated transformations or competing representations of the same data.
  4. Local control flow and naming that materially obstruct comprehension.
- Record each candidate's reach, recurring cost, expected simplification,
  behavior risk, evidence, and validation effort qualitatively; no weighted
  score. Complexity, size, churn, and dependency counts locate questions; they
  neither prove a defect nor justify extracting a helper. Keep Go and Biome
  results separate per the [Sonar contract](../frontend/sonar.md).
- Check the [settled findings](../../.agents/skills/app-review/references/settled-findings.md)
  before re-proposing a consolidation. Record rejected candidates with the
  evidence or future trigger for revisiting them.
- Size a batch by coherent ownership and reviewability (an owner plus affected
  consumers, or several improvements in one subsystem), not file counts,
  deletion quotas, or finding counts. One function, the first easy finding, or
  one local cleanup in a largely unexamined scope is not a batch; if little is
  worth changing, record the evidence and move on rather than padding the diff.

## Validation cadence

The skill's "test each simplification" means focused checks while building the
batch, not the repository gate after every edit.

1. Investigation: run relevant existing tests; no unrelated full-suite
   baseline by default.
2. Each edit: smallest meaningful affected tests plus local complexity checks;
   widen to adjacent consumers when their contract is crossed. Reuse passing
   results until a later change invalidates them; no per-edit full coverage.
3. Batch boundary: affected coverage, remaining runtime checks, and
   `qc:prerelease` once. Rerun only for failures, formatter changes, later
   edits, or concerns that invalidate the evidence.

Progress updates are not delivery boundaries. Documentation upkeep must not
become a code batch's main output.

## Execute the batch

1. Name responsibilities and files. Trace producers, consumers, identity,
   ordering, failure paths, cleanup, and dependency directions; record cycle
   risk before proposing a shared owner.
2. State the maintenance problem as before/after: what disappears (duplicate
   policy, unnecessary state, nested orchestration, conversions, indirection)
   and what intentional complexity remains.
3. Confirm characterization tests; add missing meaningful cases and run them
   against the current code first. An intended behavior change is separate
   red/green work.
4. Change incrementally through all accepted candidates before the full gate.
   Existing tests must not need weaker assertions. Follow shared owners; no
   feature-local exceptions or speculative frameworks.
5. Review readability and total responsibilities, including new helpers;
   extracting branches only to move a complexity score does not qualify.
6. Run the batch-boundary checks from the [completion contract](completion.md)
   and inspect formatter changes. Failed, blocked, or unrun checks go in the
   ledger and keep the batch open.
7. Record the result, each candidate's disposition, remaining scope, and the
   next domain.

## Coverage and stopping rules

- Unit: `inventoried` → `reviewing` → `reviewed`, with explicit inspected scope.
- Candidate: `investigate` → `confirmed` → `implementing` → `validated`, or
  `not warranted` (with evidence) or `deferred` (reason and re-entry
  condition). Deferred or blocked changes remain outstanding.
- A pass may conclude the current code is preferable; do not require a change
  in every file, a deletion quota, or a lower line count.
- A cycle ends when every scheduled domain has a recorded disposition; the
  repository review is complete only when every inventory unit was inspected.
  Neither means deferred implementation or validation is complete.
- Report reviewed units, concrete simplifications, rejected/deferred work, and
  validation evidence, not edit counts.
