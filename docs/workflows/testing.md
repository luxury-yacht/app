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

Use red/green/refactor for production behavior changes. Copy, cosmetic styling,
documentation, and test-only pruning do not need a manufactured failing test.
For pruning, run the surviving affected tests, measure and report coverage
impact, and run the repository gate. Keep production behavior and test/coverage
configuration unchanged. A lower percentage is acceptable when it reflects
removing tests that only exercise presentation; do not add filler tests to
restore it. Investigate lost coverage of meaningful branches.
