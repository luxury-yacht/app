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
Remove fixtures and imports left unused by pruning. Moving the same assertions
into a loop is not pruning; remove redundant obligations instead.

During a pruning pass, check whether the application still reaches the code
under test. A dependency audit is a candidate list, not proof: search imports,
re-exports, lazy loaders, and runtime entry points before removing an orphaned
module and its tests. Preserve styles or helpers still used by the current UI.
For a shared pass-through path, keep one representative consumer test; vary
resource kinds only when the asserted behavior actually branches on kind.

Pruning keeps production behavior and test/coverage configuration unchanged.
Investigate lost coverage of meaningful branches; a drop from removing
presentation-only tests is acceptable.

## Frontend state: the real-state harness

Frontend suites never stub the app's state owners: the contexts, stores,
refresh and data-access layers, capabilities, navigation, persistence hooks,
dockable panels, and panel-window modules that
[no-owned-state-mocks.grit](../../frontend/biome-plugins/no-owned-state-mocks.grit)
lists. Biome fails a test file that mocks one; only `*.benchmark.test.*` files
are exempt, because a benchmark times one component's own work. Run those
owners for real with `installAppStateHarness()`
([harness.tsx](../../frontend/src/test-utils/appState/harness.tsx)), which
renders the production composition (`AppShell`, `PanelWindowShell`) after the
same bootstrap as `main.ts`.

**Only the boundary is faked.**

- Backend RPCs: answer with `app.backend.answer`, park with `hold`, and assert
  with `calls`. An unanswered method fails the test.
- Refresh HTTP: snapshot reads (`app.snapshots.serve`, `fail`, `answer`,
  `respond`, `reads`), refresh jobs, metrics activity, and telemetry
  (`app.snapshots.telemetry`, or `failTelemetry` for an unreachable server).
  A read nobody serves answers 503, which the app reports, so the test fails.
  An aborted read rejects, as a real fetch does.
- Streams: `app.streams` (`active`, `requests`, `acknowledge`, `ring`).
- Runtime events: `app.events.emit`.
- Permissions: `app.permissions`, `app.denyPermissions`. A decision of
  `{ error }` is a check the cluster could not evaluate; the backend reports
  it per check, never as a failed call.
- Window identity and controls.
- The jsdom gaps: `matchMedia`, scrolling, and hit testing.

Suites may still stub `@core/backend-api` or `@core/desktop-runtime` when they
use no harness, external packages, and child components jsdom cannot run, such
as the object map's canvas renderer.

**Mount modes.**

- Full app (`app.mountApp`) is for anything under a route-owned or
  panel-owned provider: views, object panels, and the layout.
- Provider mode (`app.render(null)`, then `view.show(ui)`) is for hooks, owners'
  own suites, and components whose ancestors add nothing the assertions
  depend on.
- Panel-window mode is for detached panel windows.

The composition decides the mode, never speed.

**Seeding.**

- Declare fixtures before mounting: `app.cluster`, `namespaces`,
  `startScreen`, `object`, `servePanel`, `serveTable`, `preferences`, and
  `panelWindow`.
- The window opens on its first open cluster; switch with
  `view.selectCluster`.
- A cluster's lifecycle, auth, and health at startup are fixture options. To
  change them mid-test, use `app.setClusterState`: the backend's workspace
  state keeps the change, so a later tab switch does not revert it, and the
  window receives the backend's events for it.
- A surface's refresh demand without the surface comes from `view.lease`,
  which leases the way a mounted view does and resolves to its release.
- State the app hydrates once at startup, such as saved table state or
  favorites, comes from its RPC answer before the mount.
- Use fake timers for debounces and stream teardown (500 ms).

**Driving and asserting.**

- Act as the user does: `view.goTo` clicks the sidebar, and keys, clicks, and
  native events reach the real handlers.
- Assert what leaves the boundary (RPC payloads, reads, stream requests) or
  the real owners' state (`view.owners()`, `view.openPanels()`), with complete
  object identity.
- The harness records every error report. A test fails on one it did not
  take with `app.errors.take`; expected permission denials are exempt.

**Isolation.** Module state survives between tests in a file, so
[moduleState.ts](../../frontend/src/test-utils/appState/moduleState.ts) resets
every owner a mount can reach. When you add module-scope state that a mount
reaches, reset it there:

1. through the owner's public API;
2. else through an existing test hook;
3. else through a new, narrowly named `…ForTesting` export.

Then add a reused-identity case to
[harness.isolation.test.tsx](../../frontend/src/test-utils/appState/harness.isolation.test.tsx)
that fails without the reset.

Each test in a harness suite takes at most 1.0 s. Native behavior (dragging,
window placement, focus across windows) still needs the native app; see the
[completion gate](completion.md).

## Test environment

Isolate the backend test process's config and cache directories before fixtures
run, as in [TestMain](../../backend/main_test.go). Per-test overrides must restore
to those disposable roots so late background work cannot write real app settings.
Validate isolation through the real state resolver in a child process.

Finish binding generation before source-inventory tests enumerate frontend files;
generation can create and remove temporary trees. If generated coverage HTML enters
frontend lint scope, preserve the reports outside the frontend tree and rerun the
unchanged gate. Keep coverage summaries for evidence; do not weaken source lint.
