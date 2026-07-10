# Plan: Biome strictness technical debt

## Status

Created 2026-07-10 after the ESLint and Prettier migration.

Progress:

- ✅ Phase 1 completed 2026-07-10: exception snapshot validation, exact-rule enforcement, quality
  gate integration, and review guidance.
- ⏳ Phase 2 in progress: test and Storybook type escapes.
- ⬜ Phase 3 not started: accessibility and shared icon exceptions.
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

`src/**/*.test.{ts,tsx}` and `.storybook/mocks/**` currently disable:

- `lint/style/noNonNullAssertion`
- `lint/suspicious/noExplicitAny`

These exceptions support partial browser, Wails, React, and third-party mocks, but they can also
hide malformed fixtures and unsafe assertions. This is real technical debt rather than a permanent
tool boundary.

Exit criteria:

- Tests and Storybook mocks pass both rules at error level.
- Shared typed factories exist for frequently mocked Wails, browser, React, and third-party APIs.
- Repeated non-null assertions are replaced by assertion helpers that fail with useful messages.
- The test/Storybook override is removed from `frontend/biome.json`.

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

### Accessibility overrides

The global accessibility rules are errors, while exact-file overrides remain for:

- focus-managed inputs and modal controls;
- custom combobox, menu, command-palette, and sidebar widgets;
- GridTable, object-map, drag, resize, and dockable-panel surfaces;
- keyboard-focusable log and diff regions.

Biome evaluates individual elements and does not always understand a composite widget's focus,
keyboard, and ARIA contract. The current file-level scopes are nevertheless wider than the
exceptional nodes and may mask unrelated future regressions.

Exit criteria:

- Prefer native elements wherever they preserve the required behavior and styling.
- Extract reusable accessible primitives for menus, listboxes, grids, drag handles, and focusable
  regions.
- Add interaction tests covering pointer and keyboard activation, focus entry/exit, disabled state,
  and required ARIA relationships.
- Replace each file-level accessibility override with either no override or an exact inline
  suppression on the composite-widget boundary.
- Do not add a new file to an accessibility override without documenting its widget contract here.

### Shared icon accessibility

`src/shared/components/icons/**` disables `noSvgWithoutTitle`. Several shared SVG components rely
on their consuming control for an accessible name but do not encode whether the SVG is decorative
or meaningful at the icon boundary.

Exit criteria:

- Shared icons default to decorative semantics, including `aria-hidden="true"` and focus exclusion
  where applicable.
- Meaningful standalone icons accept an explicit accessible title or label contract.
- Cursor assets remain explicitly decorative.
- `noSvgWithoutTitle` is re-enabled for the shared icon directory.

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
- ✅ Current strict audit: 758 explicit-`any` and 882 non-null-assertion diagnostics remain. The
  largest concentrations are shared tables, object-panel components, namespace components,
  dockable panels, refresh streaming, and object-map tests.
- ⏳ The next boundary should remain a narrow directory or file from the measured inventory; the
  broad test override stays in place only for test paths not yet listed in the strict override.

- ✅ Inventory explicit `any` by mock boundary and introduce shared typed factories.
- ✅ Inventory non-null assertions by pattern and introduce assertion helpers.
- [ ] Enable the two rules for one test area at a time.
- [ ] Remove the broad test and Storybook override.

### Phase 3: Narrow accessibility exceptions

- [ ] Audit focus-managed controls and remove avoidable `autoFocus` exceptions.
- [ ] Consolidate menu, combobox, and command-palette keyboard behavior.
- [ ] Consolidate grid, drag, resize, and dockable-panel interaction primitives.
- [ ] Convert file overrides to exact inline suppressions or remove them.
- [ ] Standardize shared icon semantics and re-enable SVG title checking.

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
