# Plan: Biome strictness technical debt

## Status

Created 2026-07-10 after the ESLint and Prettier migration.

Progress:

- ✅ Phase 1 completed 2026-07-10: exception snapshot validation, exact-rule enforcement, quality
  gate integration, and review guidance.
- ✅ Phase 2 completed 2026-07-10: test and Storybook type escapes eliminated.
- ✅ Phase 3 completed 2026-07-10: accessibility overrides eliminated and shared icon semantics standardized.
- ⬜ Phase 4 not started: CSS cascade exceptions.
- ⬜ Phase 5 not started: unnecessary hook dependency reporting.

The production baseline uses Biome's recommended rules and promotes the project's selected
accessibility, correctness, complexity, suspicious, and style rules to errors. The remaining
exceptions are recorded here so they stay visible and can be removed deliberately rather than
becoming permanent, unexplained configuration.

When this plan is finished, move any durable lint policy into the appropriate frontend
documentation or agent guidance, then delete this file.

## Goals

- Keep production code under the strict global rule set.
- Replace broad overrides with typed helpers, accessible primitives, or node-level suppressions.
- Preserve intentional architectural and protocol boundaries.
- Require a rationale and the narrowest practical scope for every remaining suppression.
- Prevent new code from increasing the exception surface.

## Current exception ledger

### Test and Storybook type safety

`src/**/*.test.{ts,tsx}` and `.storybook/mocks/**` now inherit the global errors for:

- `lint/style/noNonNullAssertion`
- `lint/suspicious/noExplicitAny`

The former broad test override has been removed. Browser, Wails, React, and third-party mocks now
use typed contracts, reversible property installers, fixture constructors, or fail-fast assertion
helpers instead of explicit `any` and non-null assertions.

Completed exit criteria:

- ✅ Tests and Storybook mocks pass both rules at error level.
- ✅ Shared typed factories exist for frequently mocked Wails, browser, React, and third-party APIs.
- ✅ Repeated non-null assertions use assertion helpers that fail with useful messages.
- ✅ The test override and redundant incremental strict override are removed from
  `frontend/biome.json` and `frontend/biome-exceptions.json`.

### React dependency reporting

`useExhaustiveDependencies` remains an error for missing dependencies, but
`reportUnnecessaryDependencies` is disabled. Some effects use explicit invalidation values or
intentionally stable mount-time captures that static analysis cannot infer from the callback body.

This option can also hide genuinely redundant dependencies, so it should be revisited after those
contracts are expressed through dedicated hooks.

Exit criteria:

- Invalidation behavior is represented by named hooks or explicit revision tokens with regression
  tests.
- Mount-only and stable-callback effects use small, documented abstractions where practical.
- `reportUnnecessaryDependencies` is enabled globally.
- Any irreducible cases use exact inline suppressions rather than a global option.

### Accessibility exceptions

All accessibility rules now run at error level without configuration overrides. Native `button`,
`header`, `nav`, and `section` elements replace avoidable role shims. The shared modal focus trap
owns explicit initial-focus selection, native action-menu buttons provide keyboard activation, and
favorite rows implement keyboard activation inside their registered menu surface.

Biome still evaluates individual elements rather than the complete composite contract. Exact
inline suppressions therefore remain at the div-based virtual GridTable boundary, registered menu,
dropdown, palette, sidebar, and panel surfaces, pointer-only drag/resize propagation boundaries,
and keyboard-focusable log and diff regions. The exception snapshot records 89 accessibility
suppression occurrences across 28 files; each occurrence names an exact rule and a local behavioral
rationale. This is narrower than a file override because unrelated elements in every affected file
remain subject to the global rules.

Completed exit criteria:

- ✅ Prefer native elements wherever they preserve the required behavior and styling.
- ✅ Reuse the shared modal focus trap, registered keyboard surfaces, GridTable hooks, and dockable
  drag/resize components as the accessible composite boundaries.
- ✅ Cover native menu semantics, pointer activation, keyboard activation, modal focus entry, focus
  trapping/restoration, disabled menu items, and shared icon semantics in focused tests.
- ✅ Replace every file-level accessibility override with either no exception or an exact inline
  suppression on the composite-widget boundary.
- ✅ Reject any future accessibility override or suppression that is absent from the reviewed
  exception snapshot.

### Shared icon accessibility

Shared React icons and cursor SVG assets now default to decorative semantics with
`aria-hidden="true"` and `focusable="false"`. Their consuming native control, labelled region, or
adjacent text owns the accessible name; callers can no longer opt individual shared icons back into
the accessibility tree through the former optional `ariaHidden` prop.

Completed exit criteria:

- ✅ Shared icons default to decorative semantics and focus exclusion.
- ✅ Meaningful controls and regions keep their explicit label at the consuming semantic boundary.
- ✅ Cursor assets are explicitly decorative.
- ✅ `noSvgWithoutTitle` is enabled for the shared icon directory with no override.

### CSS cascade exceptions

`noImportantStyles` and `noDescendingSpecificity` are errors globally, with exact stylesheet
overrides for drag/resize states, reduced-motion utilities, visibility utilities, selectable log
content, embedded editor/terminal surfaces, and established component cascade contracts.

The declarations may currently be functional, but file-wide overrides allow unrelated future
violations in the same stylesheets.

Exit criteria:

- Classify each remaining `!important` declaration as third-party boundary, global state,
  accessibility utility, or removable specificity debt.
- Use CSS cascade layers, explicit state selectors, or component boundaries for removable cases.
- Preserve reduced-motion and visibility behavior with focused visual or browser tests.
- Narrow irreducible third-party exceptions to dedicated boundary stylesheets where practical.
- Remove files from the overrides as their final exceptional declaration disappears.

### Inline suppressions

Inline suppressions currently cover deliberate effect lifetimes, custom keyboard regions,
GridTable event delegation, test DOM harnesses, and CodeMirror mocks whose API requires static-only
classes.

Inline suppressions are preferable to file-wide overrides, but they still require maintenance.

Exit criteria:

- Every suppression names the exact rule instead of a broad category whenever Biome supports it.
- Every suppression contains a concrete behavioral or external-contract rationale.
- Delete suppressions when the relevant component, hook, mock, or upstream library contract
  changes.
- Add a review check that rejects unexplained `biome-ignore` comments.

## Intentional boundaries to retain

The following exceptions are not scheduled for removal unless their surrounding architecture
changes:

### Generated Wails backend facade

Direct imports from `@wailsjs/go/backend/App` are prohibited outside `src/core/backend-api/**`.
The facade itself must import the generated module, so its exact override is part of the boundary.

### ANSI control-sequence parsing

The log and shell parsers intentionally match ANSI escape/control characters. Their exact-file
`noControlCharactersInRegex` override expresses a protocol requirement.

### Early appearance bootstrap

`index.html` applies cached appearance variables before the React bundle executes to avoid an
initial appearance flash. Its single-file `noInnerDeclarations` override remains while this code
must execute inline and before application startup.

Retained exceptions must remain exact-file or exact-directory scopes. If their scope grows, reopen
the decision and document the new contract.

## Phased work

### Phase 1: Prevent exception growth

- ✅ Add a validation script and tests that snapshot allowed Biome overrides and inline
  suppressions.
- ✅ Require exact rule names and rationales for new inline suppressions.
- ✅ Document the expected review process for modifying `frontend/biome.json` overrides in
  `docs/frontend/biome.md`.

### Phase 2: Eliminate test type escapes

Progress as of 2026-07-10:

- ✅ Storybook mocks now use the global `noExplicitAny` and `noNonNullAssertion` errors.
- ✅ Tests under `src/hooks`, `src/shared/utils`, and `src/utils` now use both rules at error level.
- ✅ Tests under core connection, contexts, data access, events, logging, persistence, resource
  metrics, and settings now use both rules at error level.
- ✅ Added the typed `requireValue` assertion helper with a focused contract test.
- ✅ Added typed Wails event-runtime and reversible window-property test harnesses with focused
  contract tests.
- ✅ Removed 153 redundant `(globalThis as any).IS_REACT_ACT_ENVIRONMENT` assignments from 146
  test files; `vitest.setup.ts` remains the shared owner.
- ✅ Removed the remaining typed per-file `IS_REACT_ACT_ENVIRONMENT` assignments; the shared setup
  is now the only owner.
- ✅ `src/modules/resource-grid` now enforces both rules; its 28 diagnostics were replaced with
  typed production-contract mocks, fail-fast value/state-publisher helpers, validated React
  pagination elements, and direct age-cell rendering in the test probe.
- ✅ `src/core/codemirror` now enforces both rules; its 19 diagnostics were replaced with typed
  CodeMirror mock functions, one explicit partial-`EditorView` fixture boundary, and `requireValue`
  checks for captured bindings and DOM fixtures.
- ✅ `src/ui/settings/sections` now enforces both rules; its 22 DOM lookup assertions now fail at
  lookup time with fixture-specific `requireValue` messages.
- ✅ `src/ui/command-palette` now enforces both rules; its 22 diagnostics were replaced with a shared
  required-input lookup, typed snapshot options, descriptor-safe property cleanup, and the typed
  window-property harness.
- ✅ Eliminated the measured 758 explicit-`any` and 882 non-null-assertion diagnostics from the
  remaining tests, using production-derived component/hook types and typed capture boundaries.
- ✅ `npm run check --prefix frontend` and `npm run typecheck --prefix frontend` pass with the two
  rules inherited globally and no test-specific override.
- ✅ Focused validation passes for 30 changed test files: 339 tests passed.
- ✅ `mage qc:prerelease` passes: 413 frontend test files, 3,400 tests passed, 1 skipped,
  and Trivy reported zero vulnerabilities.

- ✅ Inventory explicit `any` by mock boundary and introduce shared typed factories.
- ✅ Inventory non-null assertions by pattern and introduce assertion helpers.
- ✅ Enable the two rules for all test and Storybook areas.
- ✅ Remove the broad test override and its exception-manifest entry.

### Phase 3: Narrow accessibility exceptions

Progress as of 2026-07-10:

- ✅ Removed the unused `SearchInput.autoFocus` API and replaced modal `autoFocus` attributes with
  the shared focus trap's `data-modal-initial-focus` contract.
- ✅ Confirmation dialogs focus the non-destructive cancel action; focused modal tests cover entry,
  trapping, restoration, and nested behavior.
- ✅ Converted object action entries and the Favorites trigger to native buttons; favorite menu rows
  now support keyboard activation without bypassing the registered menu surface.
- ✅ Replaced avoidable `role="navigation"`, `role="banner"`, and `role="region"` shims with native
  `nav`, `header`, and `section` elements.
- ✅ Kept GridTable, dropdown, palette, sidebar, diff/log, drag, resize, terminal, and modal backdrop
  exceptions only at exact composite nodes with rule-specific behavioral rationales.
- ✅ Made every exported shared React icon and cursor asset decorative and unfocusable by default;
  the shared-icon contract test enumerates all icon-module exports.
- ✅ Removed all eight accessibility override groups from `frontend/biome.json` and
  `frontend/biome-exceptions.json`; zero accessibility overrides remain.
- ✅ Focused validation passes across 210 affected test files: 1,756 tests passed and 1 skipped.
- ✅ `npm run check --prefix frontend`, `npm run typecheck --prefix frontend`, and
  `mage qc:prerelease` pass; the full frontend run passed 413 files and 3,404 tests with 1 skipped,
  and Trivy reported zero vulnerabilities.

- [x] Audit focus-managed controls and remove avoidable `autoFocus` exceptions.
- [x] Consolidate menu, combobox, and command-palette keyboard behavior.
- [x] Consolidate grid, drag, resize, and dockable-panel interaction primitives.
- [x] Convert file overrides to exact inline suppressions or remove them.
- [x] Standardize shared icon semantics and re-enable SVG title checking.

### Phase 4: Reduce CSS exceptions

- [ ] Audit and classify every remaining `!important` declaration.
- [ ] Introduce cascade layers or isolated boundary styles where they reduce specificity coupling.
- [ ] Remove obsolete `!important` declarations and descending-specificity exceptions.
- [ ] Remove each stylesheet from its override as soon as it passes globally.

### Phase 5: Tighten hook dependency reporting

- [ ] Introduce named invalidation and stable-lifetime hook abstractions.
- [ ] Add regression tests for effects whose behavior depends on invalidation-only values.
- [ ] Enable `reportUnnecessaryDependencies` and resolve the resulting diagnostics.

## Validation for each phase

For implementation changes, run the focused tests for the affected behavior during development,
then run:

```sh
npm run check --prefix frontend
npm run typecheck --prefix frontend
mage qc:prerelease
```

Before marking a phase complete, also verify that its changes reduce the number or scope of
overrides and suppressions rather than merely moving them.
