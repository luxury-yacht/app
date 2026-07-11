# Biome policy

Biome owns frontend formatting, linting, import organization, and repository-specific Grit rules.
The global configuration is `frontend/biome.json`.

## Strictness contract

- New production code must pass the global rule set without broad overrides.
- Prefer changing the code to satisfy a rule before considering an exception.
- Generated-code and protocol boundaries may retain narrowly scoped exceptions when the rule is
  incompatible with the boundary's required behavior.
- Test and production code inherit the same strict type-safety and hook-dependency rules.

The repository uses Biome's `recommended` preset as its portable baseline and explicitly promotes
additional applicable rules to errors. The explicit non-recommended rules currently include
`noImportCycles`, `noLeakedRender`, `noMisplacedAssertion`, `noSkippedTests`,
`noUnusedExpressions`, and `noUnusedInstantiation`. Explicit rules are also recorded in the
exception manifest so removing or weakening one fails the policy check.

Do not replace this curation with the `all` preset. `all` includes framework and domain rules that
do not describe this React application. Audit new Biome releases for newly applicable rules and
promote them individually with their diagnostics resolved.

`noUnnecessaryConditions` is the remaining high-signal candidate. Biome 2.5.3 currently panics in
the module resolver while running it across this project (`module_resolver.rs:500`, index out of
bounds), so it must not enter the required gate until the installed Biome version can run it to
completion. Re-evaluate it after Biome upgrades with:

```sh
npx biome lint . --only=lint/suspicious/noUnnecessaryConditions
```

## React hook dependency lifetimes

`reportUnnecessaryDependencies` is enabled. Ordinary React dependency arrays contain only values
read by the callback. Reducer dispatchers, state setters, ref objects, and module constants do not
belong in an array merely because the callback uses them.

Use the helpers in `src/shared/hooks/useHookLifetimes.ts` when the callback has a lifecycle contract
that React and Biome cannot infer:

- `useEffectWithInvalidation` and `useLayoutEffectWithInvalidation` separate values read by the
  effect from revision, identity, cache, or collection tokens that intentionally restart it.
- `useMemoWithInvalidation` recomputes ref-backed data when an explicit revision token changes.
- `useMountEffect` makes a mount-only capture and its unmount cleanup explicit.

Biome registers the three invalidation helpers as exhaustive-dependency hooks, so their ordinary
dependency lists still receive missing- and unnecessary-dependency analysis.

Put values read by a callback in the normal dependency list and invalidation-only values in the
separate invalidation list. Do not use these helpers to hide a missing dependency or to retain a
redundant one. New lifecycle helpers require regression tests that prove rerun, cleanup, and stable
lifetime behavior.

`biome-exceptions.json` also snapshots every file and count that calls an invalidation or mount
lifetime helper. Adding, removing, or changing a callsite fails the policy check. Treat that
failure as a required lifecycle review: prove the separate invalidator or mount-only capture with
a caller-level regression test before updating the inventory.

The approved hook-rule suppression surface is intentionally narrow:

- four suppressions inside `useHookLifetimes.ts`, where the helper APIs implement the explicit
  lifetime contract;
- one controlled-field persistence effect in `LogViewer.tsx`;
- one stable ref callback in `useTabDropTarget.ts` whose identity must not churn;
- one state-only overflow remeasurement in `Tabs.tsx`, where tab identity changes scroll width
  without changing the observed container size;
- two tab-count remeasurements in `ClusterTabs.tsx`, where tab content changes can require height
  and label-fit checks without changing either observed box;
- one GridTable visible-auto-column invalidation, where virtual row-range changes alter the
  rendered-cell signature without changing the dirty-marking callback identity.

All other hook dependency arrays must pass missing- and unnecessary-dependency reporting directly.

## Exception manifest

`frontend/biome-exceptions.json` is the approved snapshot of:

- every config override that disables a rule;
- every inline `biome-ignore`, aggregated by file and exact rule.
- every required explicit error rule, exhaustive-dependency hook, and Grit boundary plugin;
- every approved invalidation or mount lifetime-helper callsite.

`npm run check:biome-exceptions --prefix frontend` compares the code and config with that
manifest. It fails for both new exceptions and stale entries, so removing an exception also
requires shrinking the manifest.

The manifest is not permission to add an exception. It makes exceptional scope explicit and
reviewable.

The validator scans the whole frontend project for Biome-supported source/config extensions,
including the repository's `.mjs` and `.cjs` scripts, while excluding dependency, build, coverage,
lockfile, and generated-binding trees. It rejects:

- `biome-ignore-all`, `biome-ignore-start`, and `biome-ignore-end`;
- inline suppressions without an exact rule and rationale;
- disabled formatter, assist, or linter configuration;
- global rule shutdowns, `preset: none`, and override-level linter shutdowns;
- removal or weakening of required rules, hooks, or plugins;
- changes to the exact include/exclude scope of a required Grit plugin.

The Grit plugins have executable adversarial fixtures in
`frontend/scripts/check-biome-boundaries.test.mjs`. Isolated fixtures prove each pattern rejects its
forbidden direct call and accepts a call through the approved facade. Real-project fixtures also
lint temporary files under `frontend/src` through `frontend/biome.json`; these guard the configured
plugin globs and backend-binding import patterns, not only the plugin source.

## Reviewing a config override

Before adding or expanding an override:

1. Run the rule without the proposed override and record the exact diagnostics.
2. Confirm that native elements, typed helpers, or a local refactor cannot satisfy the contract.
3. Scope the override to exact files and exact rules; never disable a whole rule category.
4. Add a concrete rationale to `biome-exceptions.json` describing the behavioral, generated-code,
   third-party, or protocol constraint.
5. Update this policy or the relevant durable frontend contract when the exception establishes a
   reusable boundary.
6. Add focused regression coverage for any behavior the ignored rule would normally protect.

## Reviewing an inline suppression

Inline suppressions must:

- name every exact rule, such as `lint/a11y/noStaticElementInteractions`;
- include a rationale after `:` that describes the real contract;
- sit directly on the exceptional statement or JSX node;
- be added to the exception manifest with its file, rule, and occurrence count.

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
