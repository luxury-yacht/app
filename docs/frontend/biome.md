# Biome policy

Biome owns frontend formatting, linting, import organization, and repository-specific Grit rules.
The commented global configuration is `frontend/biome.jsonc`.

## Strictness contract

- New production code must pass the global rule set without broad overrides.
- Prefer changing the code to satisfy a rule before considering an exception.
- Generated-code and protocol boundaries may retain narrowly scoped exceptions when the rule is
  incompatible with the boundary's required behavior.
- Test and production code inherit the same strict type-safety and hook-dependency rules.

The repository uses Biome's `recommended` preset as its portable baseline and explicitly promotes
additional applicable rules to errors. The explicit non-recommended rules include accessibility,
React correctness, and suspicious-code checks such as `noNoninteractiveElementInteractions`,
`useImageSize`, `useUniqueElementIds`, `noEvolvingTypes`, `noImportCycles`, `noLeakedRender`,
`noMisplacedAssertion`, `noNestedPromises`, `noReturnAssign`, `noSkippedTests`, `noUnresolvedImports`,
`noDelete`, `noEmptyBlockStatements`, `noForIn`, `noReactForwardRef`, `noShadow`, `useGuardForIn`,
`useMaxParams`, `noConsole`, `noEnum`, `noEqualsToNull`, `noParameterAssign`,
`noParameterProperties`, `noUnusedExpressions`, `noUnusedInstantiation`, `noUnusedTemplateLiteral`,
`useBlockStatements`, `useConsistentObjectDefinitions`, and `useStrictMode`. The commented
`frontend/biome.jsonc` file is the authoritative rule configuration.

`useMaxParams` uses a project ceiling of seven parameters. Functions above that ceiling must group
cohesive inputs into a typed object. The ceiling deliberately retains five-to-seven-argument
callback, coordinate, and compact transformation signatures where wrapping the values would make
the call less direct. Changes to the ceiling are reviewed directly in `frontend/biome.jsonc`.

Do not replace this curation with the `all` preset. `all` includes framework and domain rules that
do not describe this React application. Audit new Biome releases for newly applicable rules and
promote them individually with their diagnostics resolved.

`noUnnecessaryConditions` is the remaining high-signal candidate. Biome 2.5.3, confirmed as the
latest stable release on 2026-07-11, panics in the module resolver
(`module_resolver.rs:500`, index out of bounds), so it must not enter the required gate until the
installed Biome version can run it to completion. The minimized project reproduction is:

```ts
import { act } from 'react';
export async function value() {
  await act(async () => {});
}
```

Run that file and the complete frontend after Biome upgrades:

```sh
npx biome lint . --only=lint/suspicious/noUnnecessaryConditions
```

`useArraySortCompare` has the same analyzer blocker. Its 11 source diagnostics have explicit
UTF-16 comparators, but enabling the rule globally still activates the crashing module resolver.
The same five-line reproduction above crashes this rule. Keep the explicit comparators and
re-evaluate the rule with `noUnnecessaryConditions` after a Biome upgrade.

## Project import-resolution rules

`noUnresolvedImports` is enabled. Package boundaries whose runtime is exposed through CommonJS or
synthetic defaults use namespace imports so Biome, TypeScript, Vite, Vitest, and Storybook agree on
the module shape. The isolated rule checks the complete frontend with zero diagnostics.

Two resolution rules are deliberately not enabled:

- `noUndeclaredDependencies` reports 1,688 diagnostics because Biome 2.5.3 treats configured
  TypeScript/Vite aliases such as `@shared/components`, `@core/contexts`, and `@wailsjs/go` as npm
  package names. Adding those aliases to `package.json` would create fake dependency declarations.
- `useImportExtensions` reports 3,699 diagnostics and requests source `.ts`/`.tsx` suffixes for
  relative and aliased imports. This frontend uses TypeScript `moduleResolution: bundler`; Vite,
  Vitest, and Storybook resolve extensionless source specifiers and emit bundled JavaScript. Source
  extensions would couple imports to implementation filenames without improving runtime
  resolution.

Re-evaluate both rules when Biome can consume the project's TypeScript path and bundler-resolution
semantics directly.

## Rules deliberately not adopted

The following non-recommended rules were evaluated against this frontend and rejected as blanket
gates. Revisit them when their rule semantics or the application architecture changes:

- `performance.useTopLevelRegex`: the 2026-07-11 isolated audit found 158 diagnostics, including 90
  in tests or stories and 66 in production. `biome explain useTopLevelRegex` warns that hoisting
  every expression can increase browser startup work. Keep hot regular expressions top-level when
  profiling supports it; do not force cold and test-only expressions to module initialization.
- `performance.noJsxPropsBind`: the isolated audit found 504 diagnostics. An AST classification of
  the flagged JSX found at least 269 intrinsic DOM handlers and 196 component props. Intrinsic
  handlers cannot invalidate a memoized child component, so the blanket rule would add callback
  hooks and dependency arrays without establishing a performance contract. Stabilize individual
  component callbacks only when profiling or API identity requires it.
- `style.useComponentExportOnlyModules`: Vite React and HMR are configured in
  `frontend/vite.config.ts:9-16`, but the isolated audit found 106 diagnostics: 65 production
  exports across 33 modules and 41 test/story exports. The production set includes 23 context hooks
  and 18 helper functions that intentionally share their provider or component module. The project
  accepts a full reload for those edited modules instead of splitting cohesive public APIs solely
  to preserve development Fast Refresh state.
- `suspicious.useAwait`: the 2026-07-11 isolated audit found 447 diagnostics: 425 in tests or
  stories, 21 in production, and one in tooling. The production findings are promise-returning
  brokers, facades, and lifecycle adapters; the test findings are predominantly async mock and
  callback contracts. Removing `async` can change synchronous throws and promise settlement, while
  adding an otherwise unnecessary `await` would exist only for the analyzer. Keep promise contracts
  explicit and use `await` where the function actually consumes asynchronous work.
- `style.useDefaultSwitchClause`: all ten findings were reviewed. Eight switches exhaust typed
  resource-metric field unions, one exhausts the dock-position union, and one handles the
  open-ended `KeyboardEvent.key` string. A mandatory default would hide newly added union members
  or add a no-op branch to keyboard behavior that already ignores unknown keys.
- `complexity.noForEach`: the isolated audit found 302 diagnostics across 129 files: 245 in
  production, 53 in tests or stories, and four in tooling. The rule applies to every method named
  `forEach`, not only arrays, and its proposed loop form is a coding convention rather than a
  repository invariant. Use the iteration form that preserves the collection's semantics and
  makes early exit, sparse entries, and index use clear.
- `complexity.noVoid`: the isolated audit found 220 diagnostics, including 215 in production.
  This frontend uses `void promise` to mark intentionally detached work and `void token` as the
  documented hook-invalidation contract. Removing those markers would make promise ownership and
  dependency lifetimes less explicit; detached promises must still handle rejection at their
  owning boundary.
- `style.noDefaultExport`: the isolated audit found 119 diagnostics across 118 files. Storybook CSF
  metadata and Vite configuration require default exports, and ambient asset declarations expose
  default module values. Retaining default component exports alongside those framework contracts
  avoids a mixed global rule with permanent exceptions.
- `style.useGlobalThis`: the isolated audit found 409 diagnostics, including 247 in production.
  Most production uses intentionally name the browser owner (`window` for timers, viewport,
  storage, media queries, and Wails globals; `document` for DOM ownership). Replacing those with
  `globalThis` would erase environment intent without changing capability or portability.
- `style.noNamespace`: both findings are in `.storybook/mocks/wailsModels.ts`, whose exported
  `backend` and `types` namespaces intentionally reproduce the generated Wails model API in
  Storybook. Flattening that mock would make stories differ from the runtime import contract.
- `performance.noReExportAll`: the 12 findings include the generated refresh-contract facade and
  maintained broker/diagnostics/resource-metrics entry points. Explicitly mirroring every generated
  export would create a second registry that can drift; these boundaries intentionally re-export
  their complete owned contract.
- `performance.noBarrelFile`: all 24 findings are maintained public entry points or cohesive module
  surfaces such as data access, capabilities, refresh, dockable panels, tabs, shortcuts, and YAML.
  Consumers use these boundaries to preserve dependency direction; bypassing them for direct file
  imports would weaken ownership for an unmeasured bundling hypothesis.
- `performance.noNamespaceImport`: the 41 findings are cohesive APIs: the shared column-factory
  catalog, `yaml`, React/ReactDOM adapters, and test modules that inspect complete export surfaces.
  Vite/Rollup can tree-shake these ES modules, while named imports would make the factory and YAML
  call sites less explicit about their owning API.

## React hook dependency lifetimes

`reportUnnecessaryDependencies` is enabled. React dependency arrays contain only values read by
the callback. Reducer dispatchers, state setters, ref objects, and module constants do not belong
in an array merely because the callback uses them.

Use standard React hooks for every lifecycle. When a revision, identity, cache, collection, or DOM
measurement token intentionally invalidates a callback without otherwise contributing to its
result, make that contract explicit with `void token;` inside the callback and include `token` in
the dependency array. This keeps Biome's missing- and unnecessary-dependency analysis active at
the real callsite.

For mount-only work that needs current callback logic without restarting the effect, define the
callback with `useEffectEvent` and invoke it from a standard `useEffect` with an empty dependency
array. Caller-level tests must prove rerun, cleanup, and stable-lifetime behavior when a lifecycle
contract is non-obvious.

Hook dependency suppressions and custom lifetime-hook allowlists are not approved.

## Suppression guard

`npm run check:biome-suppressions --prefix frontend` scans Biome-supported frontend source and
configuration files. It rejects broad suppression ranges and requires every inline suppression to
name an exact rule and include a rationale. Biome configuration changes remain visible directly in
`frontend/biome.jsonc` rather than being duplicated in a policy manifest.

The Grit plugins have executable adversarial fixtures in
`frontend/scripts/check-biome-boundaries.test.mjs`. Isolated fixtures prove each pattern rejects its
forbidden direct call and accepts a call through the approved facade. Real-project fixtures also
lint temporary files under `frontend/src` through `frontend/biome.jsonc`; these guard the configured
plugin globs and backend-binding import patterns, not only the plugin source.

The single disabled-rule scope is `style.noRestrictedImports` under
`src/core/backend-api/**`. That facade must import the generated Wails App binding it isolates from
application code. Boundary tests reject both relative and `@wailsjs` imports everywhere outside
the facade and accept the same import inside the exact approved directory. Remove the override only
when Biome can express an allowed entry point without disabling the rule for that directory.

## Reviewing a config override

Before adding or expanding an override:

1. Run the rule without the proposed override and record the exact diagnostics.
2. Confirm that native elements, typed helpers, or a local refactor cannot satisfy the contract.
3. Scope the override to exact files and exact rules; never disable a whole rule category.
4. Update the relevant durable frontend contract when the exception establishes a
   reusable boundary.
5. Add focused regression coverage for any behavior the ignored rule would normally protect.

## Reviewing an inline suppression

Inline suppressions must:

- name every exact rule, such as `lint/a11y/noStaticElementInteractions`;
- include a rationale after `:` that describes the real contract;
- sit directly on the exceptional statement or JSX node;

Do not use category suppressions such as `lint/a11y`. If one node needs multiple exceptions, list
each exact rule in the same directive.

## Validation

Use the combined check during development:

```sh
npm run check --prefix frontend
```

For non-documentation work, finish with:

```sh
mage qc:prerelease
```
