# Biome policy

Biome owns frontend formatting, linting, import organization, and
repository-specific Grit rules. The commented `frontend/biome.jsonc` is the
authoritative rule configuration.

## Strictness contract

- New production code passes the global rule set without broad overrides;
  change the code before considering an exception.
- Generated-code and protocol boundaries may keep narrowly scoped exceptions
  when a rule conflicts with the boundary's required behavior.
- Test and production code share the same strict type-safety and
  hook-dependency rules.
- The baseline is Biome's `recommended` preset plus individually promoted
  non-recommended rules (accessibility, React correctness, suspicious code).
  Audit new Biome releases and promote applicable rules individually with their
  diagnostics resolved. Rejected: the `all` preset — it includes framework and
  domain rules that do not describe this React application.
- `useMaxParams` allows at most seven parameters; above that, group cohesive
  inputs into a typed object. Five-to-seven-argument callback, coordinate, and
  compact transformation signatures are deliberately allowed. Review ceiling
  changes directly in `frontend/biome.jsonc`.

## Blocked candidates

`noUnnecessaryConditions` and `useArraySortCompare` (Biome's `types` domain)
stay out of the required gate. Re-evaluated 2026-10-05 on Biome 2.5.15
(latest stable):

- The 2.5.3 module-resolver panic (`module_resolver.rs:500`) is fixed; both
  rules run the full tree to completion.
- Blocker: under this layout (`frontend/biome.jsonc` is `"root": false` and
  extends the repository-root config) Biome runs no `types`-domain rule.
  Enabling it in config, via `--only`, or with `linter.domains.types` reports
  nothing, so a clean run is not evidence. Project-domain rules
  (`noUnresolvedImports`, `noImportCycles`) are unaffected. A `"root": true`
  frontend config makes the rules run, but then Biome invoked from the
  repository root (and editors opened there) fails with "Found a nested root
  configuration".
- Findings with the frontend config as root: `useArraySortCompare` 6, all
  test sorts of string lists where default UTF-16 order is intended; it misses
  spread copies (`[...xs].sort()`). `noUnnecessaryConditions` 178 (121
  production): 81 `??`, 68 `?.`, 29 constant or unreachable conditions. False
  positives include mutable class fields read as their literal initializer
  (`RefreshManager.isGloballyPaused`,
  `ResourceStreamConnection.closed`/`paused`) and `switch` cases over
  `Extract<RefreshDomain, …>` reported unreachable; acting on them deletes
  live logic. Many `??`/`?.` findings guard wire or
  persisted data whose TypeScript types overstate the runtime guarantee.
- Keep the explicit UTF-16 comparators that satisfy `useArraySortCompare`.

After each Biome upgrade, re-evaluate with a positive control, not a clean
run. In a scratch copy of `frontend/` (config with `"root": true` and no
`extends`, `src/` copied, `node_modules` symlinked), lint this probe and
confirm both rules report it before trusting project counts:

```ts
export function head<T>(items: T[]) {
  if (items) {
    return items[0];
  }
}
export const sorted = (values: number[]) => values.sort();
```

```sh
npx biome lint src/probe.ts --only=lint/suspicious/noUnnecessaryConditions --only=lint/suspicious/useArraySortCompare
```

Then confirm the same probe in the real `frontend/` also reports; until it
does, enabling either rule in `frontend/biome.jsonc` adds an inert gate.

## Import resolution

`noUnresolvedImports` is enabled with zero diagnostics. Package boundaries
exposed through CommonJS or synthetic defaults use namespace imports so Biome,
TypeScript, Vite, Vitest, and Storybook agree on the module shape. Re-evaluate
these rejections when Biome can consume the project's TypeScript paths and
bundler resolution directly:

- Rejected: `noUndeclaredDependencies` — Biome treats TS/Vite aliases
  (`@shared/components`, `@core/contexts`, `@bindings`) as npm packages;
  declaring them in `package.json` would be fake dependencies.
- Rejected: `useImportExtensions` — with `moduleResolution: bundler`, Vite,
  Vitest, and Storybook resolve extensionless source specifiers; `.ts`/`.tsx`
  suffixes would couple imports to filenames without improving resolution.

## Rules deliberately not adopted

Rejected as blanket gates in the 2026-07-11 audit; revisit when rule semantics
or the architecture change:

- `performance.useTopLevelRegex` — hoisting every expression can add browser
  startup work. Hoist hot expressions when profiling supports it; leave cold
  and test-only expressions inline.
- `performance.noJsxPropsBind` — most findings are intrinsic DOM handlers,
  which cannot invalidate a memoized child. Stabilize component callbacks only
  when profiling or API identity requires it.
- `style.useComponentExportOnlyModules` — context hooks and helpers
  intentionally share their provider or component module. Accept a full reload
  for those modules instead of splitting cohesive APIs for Fast Refresh state.
- `suspicious.useAwait` — production hits are promise-returning brokers,
  facades, and lifecycle adapters; tests use async mock contracts. Removing
  `async` changes synchronous throws and settlement, and an added `await` would
  serve only the analyzer. Keep promise contracts explicit; `await` only where
  the function consumes asynchronous work.
- `style.useDefaultSwitchClause` — switches exhaust typed unions
  (resource-metric fields, dock position) or the open-ended
  `KeyboardEvent.key`; a mandatory default would hide new union members or add
  a no-op keyboard branch.
- `complexity.noForEach` — it matches every method named `forEach`, and loop
  form is a convention, not an invariant. Use the form that keeps the
  collection's semantics, early exit, sparse entries, and index use clear.
- `complexity.noVoid` — `void promise` marks intentionally detached work and
  `void token` is the hook-invalidation contract below. Detached promises still
  handle rejection at their owning boundary.
- `style.noDefaultExport` — Storybook CSF metadata, Vite config, and ambient
  asset declarations require default exports; a global rule would need
  permanent exceptions.
- `style.useGlobalThis` — `window` (timers, viewport, storage, media queries,
  Wails globals) and `document` intentionally name the browser owner.
- `performance.noReExportAll` — the generated refresh-contract facade and the
  broker, diagnostics, and resource-metrics entry points re-export their
  complete owned contract; mirroring each export would be a drifting registry.
- `performance.noBarrelFile` — findings are maintained public entry points
  (data access, capabilities, refresh, dockable panels, tabs, shortcuts, YAML)
  that preserve dependency direction.
- `performance.noNamespaceImport` — findings are cohesive APIs (column-factory
  catalog, `yaml`, React/ReactDOM adapters, export-surface tests) that
  Vite/Rollup can tree-shake.

## React hook dependency lifetimes

- `reportUnnecessaryDependencies` is enabled. Dependency arrays contain only
  values the callback reads; reducer dispatchers, state setters, ref objects,
  and module constants do not belong merely because the callback uses them.
- Use standard React hooks for every lifecycle. When a revision, identity,
  cache, collection, or DOM-measurement token intentionally invalidates a
  callback without contributing to its result, write `void token;` inside the
  callback and list `token` in the dependency array, which keeps Biome's
  missing- and unnecessary-dependency analysis active at the real callsite.
- For mount-only work that needs current callback logic without restarting the
  effect, define the callback with `useEffectEvent` and call it from a standard
  `useEffect` with an empty dependency array. Caller-level tests prove rerun,
  cleanup, and stable-lifetime behavior when the lifecycle contract is
  non-obvious.
- Hook dependency suppressions and custom lifetime-hook allowlists are not
  approved.

## Suppressions and overrides

- `npm run check:biome-suppressions --prefix frontend` (part of
  `npm run check --prefix frontend`) rejects broad suppression ranges and inline
  suppressions without an exact rule and rationale. Config exceptions stay
  visible in `frontend/biome.jsonc`, not in a separate policy manifest.
- Inline suppressions name every exact rule in one directive (for example
  `lint/a11y/noStaticElementInteractions`, never a category like `lint/a11y`),
  give a rationale after `:` describing the real contract, and sit directly on
  the exceptional statement or JSX node.
- `frontend/scripts/check-biome-boundaries.test.mjs` holds adversarial Grit
  plugin fixtures. Isolated fixtures prove each pattern rejects its forbidden
  direct call and accepts the approved facade; real-project fixtures lint
  temporary files under `frontend/src` through `frontend/biome.jsonc` to guard
  the configured plugin globs and backend-binding import patterns.
- The single disabled-rule scope is `style.noRestrictedImports` under
  `src/core/backend-api/**`: that facade must import the generated Wails App
  binding it isolates. Boundary tests reject the import elsewhere and accept it
  in that directory. Remove the override when Biome can express an allowed entry
  point without disabling the rule.

Before adding or expanding a config override:

1. Run the rule without the override and record the exact diagnostics.
2. Confirm that native elements, typed helpers, or a local refactor cannot
   satisfy the contract.
3. Scope the override to exact files and exact rules; never disable a whole
   rule category.
4. Update the durable frontend contract when the exception establishes a
   reusable boundary.
5. Add focused regression coverage for behavior the ignored rule would protect.

Use `npm run check --prefix frontend` as the combined check during development.
