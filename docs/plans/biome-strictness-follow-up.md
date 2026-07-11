# Plan: Finish the Biome Strictness Audit

## Goal

Enable every Biome 2.5.3 rule that provides a valid correctness, safety, accessibility,
maintainability, or demonstrated performance contract for this React/Vite frontend. Resolve the
resulting diagnostics in code instead of adding suppressions. Leave a rule disabled only when it
is inapplicable to this stack, Biome cannot analyze the project correctly, or the team explicitly
rejects the coding convention it imposes.

The current baseline is Biome's `recommended` preset plus individually promoted rules
(`frontend/biome.json:32-103`). Required promoted rules are locked by
`frontend/biome-policy.json:4-37`. The policy currently records no inline suppressions
(`frontend/biome-policy.json:74`).

## Audit evidence

This inventory was measured on 2026-07-11 with the locally installed Biome 2.5.3, reported by:

```sh
cd frontend
npx biome --version
```

Disabled-rule inventories were collected without changing configuration by running each rule
group with `--only`, which promotes disabled non-recommended rules to warnings:

```sh
npx biome lint . --only=<group> --diagnostic-level=warn --max-diagnostics=none --reporter=json
```

The project-resolution rules were also run individually to distinguish analyzer limitations from
ordinary source diagnostics:

```sh
npx biome lint . --only=noUnresolvedImports --max-diagnostics=5
npx biome lint . --only=noUndeclaredDependencies --max-diagnostics=5
npx biome lint . --only=useImportExtensions --max-diagnostics=5
```

Broad complexity, style, suspicious, and nursery audits triggered Biome panics in
`crates/biome_module_graph/src/js_module_info/module_resolver.rs:500`. The JSON output associated
189 files with `internalError/panic`. Run rules individually during implementation so one broken
type-aware analyzer does not obscure independent rules.

## Rules already known to be inapplicable

Do not enable these rules for this project unless the frontend stack changes:

| Rule | Audit result | Reason |
| --- | ---: | --- |
| `correctness.useQwikValidLexicalScope` | 2,117 | `npx biome explain useQwikValidLexicalScope` identifies this as a Qwik-domain rule; the frontend dependencies declare React 19.2.7 in `frontend/package.json:41-42`. |
| `suspicious.noReactSpecificProps` | 2,067 | `npx biome explain noReactSpecificProps` identifies this as a Solid/Qwik rule that prohibits React property names. |
| `performance.noImgElement` | 9 | `npx biome explain noImgElement` identifies this as a Next.js rule requiring `next/image`; this frontend uses Vite (`frontend/package.json:12,58`). |

These rules are why the project must continue selecting applicable rules individually instead of
using `preset: all`; the existing policy documents the same constraint at
`docs/frontend/biome.md:22-24`.

## Rules blocked by Biome analysis

### `suspicious.noUnnecessaryConditions` — 382 diagnostics

This is the highest-value blocked candidate. Biome 2.5.3 panics in its module resolver when the
rule runs across the project. The limitation and reproduction command are recorded in
`docs/frontend/biome.md:26-33`.

Work:

1. Reproduce the crash against the smallest file set that still fails.
2. Check the newest stable Biome release and upgrade through the normal dependency workflow if it
   contains the resolver fix.
3. If the newest release still fails, prepare a minimal upstream reproduction and keep the rule
   out of the required gate until the analyzer completes.
4. Once it runs, classify all diagnostics, add tests before changing any behavior-bearing guard,
   resolve valid findings, enable the rule as an error, and add it to `biome-policy.json`.

Acceptance: the isolated rule checks all frontend files without an internal error and reports zero
diagnostics.

### `suspicious.useArraySortCompare` — 11 source diagnostics resolved; analyzer still crashes

All 11 arrays now pass an explicit comparator that preserves JavaScript's default UTF-16 string
ordering. The comparator contract is covered by `frontend/src/shared/utils/sort.test.ts`. Enabling
the rule globally still activates the Biome 2.5.3 module-resolver panic across 189 files, so the
rule cannot enter the required gate yet.

Work:

1. Keep the explicit comparators and their regression test.
2. Re-run the rule after the resolver upgrade investigated for `noUnnecessaryConditions`.
3. Enable and policy-lock the rule once it checks the complete frontend without internal errors.

### Project-resolution rules

| Rule | Audit result | Current problem |
| --- | ---: | --- |
| `correctness.noUndeclaredDependencies` | 1,676 | The sample diagnostics treat configured aliases such as `@core/contexts` as package names and demand they appear in `package.json`. |
| `correctness.noUnresolvedImports` | 251 | The sample diagnostics reject supported synthetic default imports such as `import ReactDOM from 'react-dom/client'`; `npx biome explain noUnresolvedImports` also warns that TypeScript already performs this check. |
| `correctness.useImportExtensions` | 3,670 | It requests `.ts`/`.tsx` extensions for Vite/TypeScript source imports, including aliased imports. |

Work:

1. Trace `tsconfig`, Vite, Vitest, and Storybook alias/resolution configuration before changing an
   import convention.
2. Determine whether current Biome supports the same alias, synthetic-default, and module-resolution
   semantics.
3. Enable `noUndeclaredDependencies` and `noUnresolvedImports` only if Biome can agree with the
   TypeScript build without fake package declarations or broad suppressions.
4. Treat `useImportExtensions` as an explicit module-specifier convention decision. If adopted,
   migrate all affected imports mechanically, then validate Vite, Vitest, Storybook, and Wails
   builds. If rejected, document why bundler-resolved extensionless imports remain the project
   convention.

Acceptance: enabled project rules agree with `npm run typecheck`, or the documented blocker names
the precise unsupported resolver behavior and includes a minimal reproduction.

## Phase 1: High-confidence source rules

Run each rule independently. For every rule: record the red diagnostic count, resolve diagnostics,
run focused tests for behavior-bearing edits, turn the rule on as `error` in `biome.json`, add it to
`biome-policy.json`, and confirm the isolated rule and policy check are green.

| Rule | Diagnostics | Intended treatment |
| --- | ---: | --- |
| `style.noParameterAssign` | 1 | ✅ Refactored the parameter mutation to an explicit local value and policy-locked the rule. |
| `style.noUnusedTemplateLiteral` | 25 | ✅ Replaced interpolation-free template literals and policy-locked the rule. |
| `suspicious.noShadow` | 55 | ✅ Renamed shadowed bindings with context-specific names and policy-locked the rule. |
| `suspicious.noForIn` | 4 | ✅ Replaced object enumeration with own-key iteration and policy-locked the rule. |
| `suspicious.useGuardForIn` | 3 | ✅ Own-key iteration removed the unguarded loops; the rule is policy-locked as defense in depth. |
| `suspicious.noEmptyBlockStatements` | 260 | ✅ Replaced ambiguous empty bodies with explicit no-op expressions or documented inert test-double methods and policy-locked the rule. |

Acceptance: all six applicable rule audits report zero diagnostics, every adopted rule is
policy-locked, and no new suppression or disabled override exists. The separately blocked
`useArraySortCompare` rule must meet its analyzer acceptance criteria before it is policy-locked.

## Phase 2: React 19 and demonstrated performance rules

| Rule | Diagnostics | Work and decision criteria |
| --- | ---: | --- |
| `suspicious.noReactForwardRef` | 19 | ✅ Migrated production components and test harnesses to React 19 ref props using the full `React.Ref<T>` contract; 108 focused tests pass and the rule is policy-locked. |
| `performance.useTopLevelRegex` | 158 | ⛔ Rejected as a blanket gate: 90 findings are tests/stories, 66 are production, and Biome documents the browser-startup cost of hoisting cold expressions. Hot expressions remain a profiling decision. |
| `performance.noDelete` | 20 | ✅ Replaced shape deletion with stable undefined state, YAML omission, or explicit invalid-test construction; 81 focused tests pass and the rule is policy-locked. |
| `performance.noJsxPropsBind` | 504 | ⛔ Rejected as a blanket gate: AST classification found at least 269 intrinsic handlers and 196 component props. Intrinsic handlers do not create memoized-child prop churn, and no measured project regression justifies 504 callback wrappers. |
| `style.useComponentExportOnlyModules` | 106 | ⛔ Rejected after verifying Vite React HMR: the rule would split 65 production exports across 33 modules plus 41 test/story exports. Context hooks and their providers remain cohesive; affected modules may full-reload during development. |

Acceptance: React ref contracts have regression tests; performance rules are enabled only with a
demonstrated project benefit or a clear invariant, not solely because they are named “performance.”

## Phase 3: Async and control-flow rules

| Rule | Diagnostics | Work and decision criteria |
| --- | ---: | --- |
| `suspicious.useAwait` | 295 | Classify async API-contract functions, promise-forwarding wrappers, test helpers, and accidental `async`. Remove unnecessary `async` or add real awaited work; do not add meaningless `await` expressions merely to satisfy the rule. |
| `style.useDefaultSwitchClause` | 10 | Preserve exhaustive discriminated-union checks. Add a default only where unknown runtime input is possible and the fallback is intentional. |
| `complexity.useMaxParams` | 40 | Establish a project threshold before enabling. Convert cohesive high-arity APIs to typed option objects, but do not obscure small mathematical or callback signatures. |
| `complexity.noForEach` | 288 | Decide whether the project wants `for...of` as a universal convention. This is primarily a control-flow/style preference, not a correctness rule. |
| `complexity.noVoid` | 218 | Do not enable while `void token` is the documented hook-invalidation contract at `docs/frontend/biome.md:41-45`. Separately review fire-and-forget promises and ensure they have explicit error handling. |

Acceptance: adopted async rules preserve public promise contracts and have rejection-path tests;
rejected convention rules receive a rule-specific rationale in the durable Biome policy document.

## Phase 4: Remaining style and module-architecture decisions

These rules require an explicit convention decision. Diagnostic counts come from the 2026-07-11
group audit.

| Rule | Diagnostics | Decision to make |
| --- | ---: | --- |
| `style.noDefaultExport` | 116 | Named exports everywhere versus retaining framework/configuration defaults. |
| `style.useGlobalThis` | 369 | Universal `globalThis` versus context-specific `window`, `document`, and worker globals. |
| `style.useBlockStatements` | 753 | Mandatory braces for every control-flow body. |
| `style.noNamespace` | 2 | Remove TypeScript namespaces unless required by generated or declaration-merging boundaries. |
| `style.useConsistentObjectDefinitions` | 2 | Select `interface` or object type aliases as the project convention. |
| `style.noParameterProperties` | 14 | Explicit class fields versus TypeScript constructor parameter properties. |
| `style.noEnum` | 3 | Literal unions/objects versus TypeScript enums. |
| `performance.noReExportAll` | 12 | Explicit re-exports versus wildcard public surfaces. |
| `performance.noBarrelFile` | 24 | Direct imports versus maintained package/module entry points. |
| `performance.noNamespaceImport` | 41 | Named imports versus namespaces where a library exposes a cohesive API. |
| `suspicious.noConsole` | 102 | Approved application logger/test diagnostics versus a blanket console ban. |
| `suspicious.noEqualsToNull` | 101 | Explicit nullish comparisons versus intentional `value == null` checks. |
| `suspicious.useStrictMode` | 1 | Verify whether the finding is a classic script; ES modules are already strict by language semantics. |

For each rule, either enable and remediate it or record a short rule-specific rejection rationale in
`docs/frontend/biome.md`. “Not recommended by default” is not sufficient justification.

## Browser-source-only rule

`correctness.noNodejsModules` reported 29 uses. Node built-ins are valid in frontend tooling,
configuration, and test scripts but should not enter browser bundles.

Work:

1. Inventory all 29 paths.
2. Enable `noNodejsModules` as an error specifically for browser source under `src/**`.
3. Do not disable the rule globally and then suppress individual source files.
4. Validate production and Storybook builds so indirect browser imports are also caught by their
   bundlers.

Acceptance: browser source has zero Node built-in imports; Node tooling remains analyzable without
false failures.

## Existing restricted-import boundary

The only explicit disabled override is `style.noRestrictedImports` under
`src/core/backend-api/**` (`frontend/biome.json:136-146`). Its policy rationale states that the
approved Wails backend facade must import the generated binding that it isolates from application
code (`frontend/biome-policy.json:67-72`).

Work:

1. Keep the override only while the facade imports the generated Wails binding.
2. Confirm the Grit/restricted-import boundary rejects the same import everywhere outside the
   facade.
3. Remove the override if Biome gains a direct allow-entry-point option that expresses the boundary
   without turning the rule off in that directory.

## Rules that remain intentionally undecided

The following rules are not candidates for automatic adoption merely to increase a rule count:

- blanket ternary bans;
- magic-number bans;
- JSX-literal bans;
- universal default-export or barrel-file bans;
- rules for frameworks absent from `package.json`;
- rules whose analyzer cannot complete on the repository.

If a future audit finds one of these rules, evaluate its actual project contract and diagnostics.
Do not accept or reject it based only on its category or the existence of an `all` preset.

## Implementation protocol

For each adopted rule:

1. Run it alone and save the exact red diagnostic inventory.
2. Group diagnostics by underlying contract, not merely by file.
3. For behavior changes, write and run a failing regression test first, then implement the fix and
   refactor under green.
4. For mechanical syntax changes, use Biome's safe fix only after inspecting its proposed rewrite.
5. Do not use `biome-ignore`, broad overrides, category shutdowns, fake dependencies, or no-op code
   whose only purpose is satisfying the analyzer.
6. Set the rule to `error` in `frontend/biome.json`.
7. Add the rule to `frontend/biome-policy.json` so weakening or removing it fails policy validation.
8. Update `docs/frontend/biome.md` with any durable rule-specific convention or blocker.
9. Run the isolated rule, focused tests, `npm run check`, `npm run typecheck`, and the full frontend
   test suite.
10. Finish each implementation tranche with `mage qc:prerelease` and inspect `git diff --check` and
    the final worktree.

## Completion criteria

- Every applicable high-confidence rule above is enabled at error severity and policy-locked.
- Every remaining disabled rule has a precise framework, analyzer, runtime-boundary, or explicit
  convention rationale in durable documentation.
- `frontend/biome-policy.json` still contains no inline suppressions.
- No broad rule-category or linter override has been introduced.
- The Wails generated-binding override remains the only disabled-rule scope unless another boundary
  is proven unavoidable and approved explicitly.
- `npm run check --prefix frontend`, `npm run typecheck --prefix frontend`, the complete frontend
  test suite, and `mage qc:prerelease` pass on the final worktree.

## Progress

- 2026-07-11: Captured the Biome 2.5.3 disabled-rule audit, diagnostic counts, current blockers,
  rule-specific decisions, implementation order, and validation contract.
- 2026-07-11: Implemented and policy-locked `noParameterAssign`, `noUnusedTemplateLiteral`,
  `noForIn`, and `useGuardForIn`. Resolved all 11 `useArraySortCompare` source diagnostics and
  moved its gate to the analyzer-blocked section after the full Biome check reproduced the module
  resolver panic. Added a red/green regression proving Helm value derivation ignores inherited
  properties.
- 2026-07-11: Completed the remaining applicable Phase 1 rules: renamed all 55 shadowed bindings,
  made all 260 empty blocks explicit, and policy-locked `noShadow` and
  `noEmptyBlockStatements`. Phase 1 source diagnostics are zero; `useArraySortCompare` remains
  blocked only by the documented Biome resolver panic.
- 2026-07-11: Began Phase 2 by refreshing the isolated `noReactForwardRef` inventory; it now has 19
  sites across the shared ARIA grid primitives, YAML editor, and test harnesses.
- 2026-07-11: Completed Phase 2. Policy-locked `noReactForwardRef` and `noDelete`; focused suites
  pass 108 ref tests and 81 deletion-semantics tests. Rejected `useTopLevelRegex`,
  `noJsxPropsBind`, and `useComponentExportOnlyModules` as blanket gates with measured repository
  inventories and durable rule-specific rationale in `docs/frontend/biome.md`.
