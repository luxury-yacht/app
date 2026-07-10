# Biome policy

Biome owns frontend formatting, linting, import organization, and repository-specific Grit rules.
The global configuration is `frontend/biome.json`.

## Strictness contract

- New production code must pass the global rule set without broad overrides.
- Prefer changing the code to satisfy a rule before considering an exception.
- Generated-code and protocol boundaries may retain narrowly scoped exceptions when the rule is
  incompatible with the boundary's required behavior.
- Test-only type exceptions are temporary debt tracked in
  `docs/plans/biome-tech-debt.md`.

## Exception manifest

`frontend/biome-exceptions.json` is the approved snapshot of:

- every config override that disables a rule;
- every inline `biome-ignore`, aggregated by file and exact rule.

`npm run check:biome-exceptions --prefix frontend` compares the code and config with that
manifest. It fails for both new exceptions and stale entries, so removing an exception also
requires shrinking the manifest.

The manifest is not permission to add an exception. It makes exceptional scope explicit and
reviewable.

## Reviewing a config override

Before adding or expanding an override:

1. Run the rule without the proposed override and record the exact diagnostics.
2. Confirm that native elements, typed helpers, or a local refactor cannot satisfy the contract.
3. Scope the override to exact files and exact rules; never disable a whole rule category.
4. Add a concrete rationale to `biome-exceptions.json` describing the behavioral, generated-code,
   third-party, or protocol constraint.
5. Update `docs/plans/biome-tech-debt.md` unless the exception is an already documented permanent
   boundary.
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
