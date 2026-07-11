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
additional applicable rules to errors. The explicit non-recommended rules include accessibility,
React correctness, and suspicious-code checks such as `noNoninteractiveElementInteractions`,
`useImageSize`, `useUniqueElementIds`, `noEvolvingTypes`, `noImportCycles`, `noLeakedRender`,
`noMisplacedAssertion`, `noNestedPromises`, `noReturnAssign`, `noSkippedTests`,
`noForIn`, `useGuardForIn`, `noParameterAssign`, `noUnusedExpressions`,
`noUnusedInstantiation`, and `noUnusedTemplateLiteral`. The policy manifest contains the
authoritative list, so removing or weakening any required rule fails the policy check.

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

`useArraySortCompare` has the same analyzer blocker. Its 11 source diagnostics have explicit
UTF-16 comparators, but enabling the rule globally still activates the crashing module resolver.
Keep the explicit comparators and re-evaluate the rule with `noUnnecessaryConditions` after a
Biome upgrade.

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

## Policy manifest

`frontend/biome-policy.json` is the approved policy for:

- every config override that disables a rule;
- every inline `biome-ignore`, aggregated by file and exact rule.
- every required explicit error rule and Grit boundary plugin.

`npm run check:biome-policy --prefix frontend` compares the code and config with that policy. It
fails for both new exceptions and stale entries, so removing an exception also requires shrinking
the policy.

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
4. Add a concrete rationale to `biome-policy.json` describing the behavioral, generated-code,
   third-party, or protocol constraint.
5. Update this policy or the relevant durable frontend contract when the exception establishes a
   reusable boundary.
6. Add focused regression coverage for any behavior the ignored rule would normally protect.

## Reviewing an inline suppression

Inline suppressions must:

- name every exact rule, such as `lint/a11y/noStaticElementInteractions`;
- include a rationale after `:` that describes the real contract;
- sit directly on the exceptional statement or JSX node;
- be added to the policy manifest with its file, rule, and occurrence count.

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
