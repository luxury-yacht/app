# Meaningful tests

Before adding a test, state the user-visible failure or nontrivial data contract
it protects. If its only justification is that a function exists, a line is
uncovered, or the implementation currently renders something, do not add it.

## What to test

- Actions and results: navigation targets, filtering and sorting, edits,
  persistence and rollback, command payloads, clipboard/export contents.
- State and lifecycle: loading versus empty versus error, readiness gates,
  recovery, cancellation, stale results, subscriptions, and cleanup.
- Correctness boundaries: cluster isolation, complete object identity,
  permissions, redaction, parsing, unit conversion, and serialization.
- Accessibility and interaction: semantic roles, accessible names, focus
  movement, keyboard activation, disabled actions, and reachable controls.

Prefer the smallest real boundary that reproduces the failure. Mock external
dependencies as needed, but assert what the app does with their results. A
test of a mock's own output or a duplicate of the implementation is not evidence
of app behavior. Add parameterized cases only for distinct failure modes or
boundary values, not every spelling of equivalent copy.

Resource collection, table-source, watch, cache, and signal changes must meet the
[freshness acceptance checks](../architecture/data-freshness.md#required-evidence-for-resource-source-changes).
Treat production wiring as a data contract; isolated producer and consumer tests
do not prove that the application connects them.

Avoid repeating a shared component or hook's contract in every consumer suite.
Keep consumer tests for distinct wiring, identity, permissions, or outcomes;
remove repetitions that only feed fixed props through a stub. A mock setter that
rewrites captured props does not test persistence or resizing. Exercise the real
state owner for those contracts. Do not add runtime tests for barrel exports,
type-only importability, trivial getters, or assertions against a fixture created
inside the test. The compiler and existing behavior tests cover those checks.

For data-driven lookup tables, use representative destinations and distinct
fallback, alias, or normalization paths. Do not copy an entire production table
into expected values unless exhaustive membership is itself a required contract
(for example, an API allowlist or supported wire protocol).

## What to leave to review

Do not create tests solely to freeze sentence wording, headings, tooltips,
punctuation, capitalization, human-readable date decoration, CSS class names,
theme tokens, icon dimensions, DOM wrappers, or static render smoke checks.
Do not scan source text to enforce those presentation choices. Review copy and
appearance in the rendered UI when changing them.

Strings are not inherently low value. A selector that finds a button by its
accessible name can support a test that clicks it and checks the result.
Fixture names prove the correct resource was selected; CSV escaping and URLs
are data contracts. Unit conversion, timezone handling, and distinguishing
missing data from zero remain correctness tests. Recovery guidance can be the
observable decision when no typed outcome exists; assert the minimum needed to
distinguish the right recovery path, not the surrounding sentence.

Similarly, a CSS-related test needs an interaction or accessibility contract
(for example, a surface must not intercept input), not a preferred shade or
spacing. A jsdom style assertion does not establish native layout or hit testing.

## Maintaining the suite

For a mixed test, remove incidental copy/style assertions and retain the
behavioral ones. Prefer an existing behavioral test over another render-only
case of the same path. Delete an entire test only after checking its assertions
and nearby coverage; do not delete tests mechanically based on names or matchers.
Remove fixtures and imports left unused by pruning.
Reducing the case count by putting the same assertions into a loop is not pruning.
Remove redundant obligations rather than changing how the runner counts them.

During a pruning pass, check whether the application still reaches the code
under test. A dependency audit is a candidate list, not proof: search imports,
re-exports, lazy loaders, and runtime entry points before removing an orphaned
module and its tests. Preserve styles or helpers still used by the current UI.
For a shared pass-through path, keep one representative consumer test; vary
resource kinds only when the asserted behavior actually branches on kind.

Use red/green/refactor for production behavior changes. Copy, cosmetic styling,
documentation, and test-only pruning do not need a manufactured failing test.
For pruning, run the surviving affected tests, measure and report coverage
impact, and run the repository gate. Keep production behavior and test/coverage
configuration unchanged. A lower percentage is acceptable when it reflects
removing tests that only exercise presentation; do not add filler tests to
restore it. Investigate lost coverage of meaningful branches.

## Test environment

Isolate the backend test process's config and cache directories before fixtures
run, as in [TestMain](../../backend/main_test.go). Per-test overrides must restore
to those disposable roots so late background work cannot write real app settings.
Validate isolation through the real state resolver in a child process.

Finish binding generation before source-inventory tests enumerate frontend files;
generation can create and remove temporary trees. If generated coverage HTML enters
frontend lint scope, preserve the reports outside the frontend tree and rerun the
unchanged gate. Keep coverage summaries for evidence; do not weaken source lint.
