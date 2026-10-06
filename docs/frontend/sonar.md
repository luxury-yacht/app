# Sonar remediation contract

SonarQube Cloud (Automatic Analysis; no checked-in scanner) is the authority for
S3776 findings. Local analysis is an early warning, not completion evidence.

## TypeScript S3776 baseline

`frontend/scripts/typescript-s3776-baseline.json` records every open
`typescript:S3776` issue key, function identity, path, line, and score from one
completed `main` analysis. It is monotonic: a new key or an increased score on a
retained key fails the audit; lower scores and closed keys pass; updates may
only lower retained scores or remove closed keys, never accept a new or
increased issue.

Run from the repository root:

```sh
# Audit current main.
mise exec -- npm run sonar:audit:main --prefix frontend
# After a PR analysis completes: audit every open/confirmed new-code issue.
mise exec -- npm run sonar:audit --prefix frontend -- --pull-request 123
# After merge, once a newer main analysis confirms the reduction.
mise exec -- npm run sonar:baseline:update --prefix frontend
```

- The PR audit is deliberately all-rule: a complexity refactor fails if it
  trades S3776 for a correctness, accessibility, duplication, or other
  maintainability issue.
- Review the baseline JSON diff before committing it. Never update from a
  feature branch, a stale analysis, or while the audit reports a new or
  increased issue.
- The live API check is not part of the offline frontend lint/test gate. Merge
  enforcement belongs to the Sonar/GitHub status-check configuration; scripts
  make the decision reproducible but cannot make an unprotected branch require
  it.

## Local signals

The prerelease gate does not run these checks. Run the applicable one after
adding recovery branches, loops/selects, or callback logic, and again before the
gate. Review scores of changed functions and new helpers, not unrelated existing
findings in the same file. Keep Sonar's configured threshold and exclusions
unchanged.

- TypeScript: `npm run complexity` runs Biome's
  `lint/complexity/noExcessiveCognitiveComplexity` with the standalone
  `frontend/biome.complexity.jsonc` at the target of 12 (Biome's default maximum
  is 15, so a plain `--only` run hides scores of 13–15);
  `frontend/scripts/biome-complexity.test.mjs` pins the threshold. Paths are
  relative to `frontend/`; pass each file as its own argument. Use it
  directionally only: a parity spike matched 90 of Sonar's 91 TypeScript
  locations but reported 224 production findings, with few exact score
  matches. Biome-only findings are not Sonar inventory.

  ```sh
  mise exec -- npm run complexity --prefix frontend -- src/path/to/file.ts
  ```

- Go: pinned gocognit, run without adding a module dependency. Scores can differ
  from Sonar's Go analyzer, particularly for nested control flow; v1.2.1 is the
  pin because it supports integer and iterator range loops. `-over 12` lists
  only functions above the target (exit status 1 when any); drop it to see
  every score.

  ```sh
  mise exec -- go run github.com/uudashr/gocognit/cmd/gocognit@v1.2.1 \
    -over 12 backend/path/to/file.go
  ```

Split cohesive responsibilities, such as operation admission, generation
replacement, live delivery, and terminal cleanup, before adding nesting.
Preserve the timing of stale-generation guards, cancellation, publication, and
completion while moving code.

## Remediation loop

1. Record the Sonar key, score, owning contract, consumers, and directly
   affected coverage.
2. Add or confirm characterization cases before moving branches.
3. Refactor one responsibility at a time and rerun focused tests.
4. Run the local signal for every changed function and new helper, not only the
   function Sonar flagged; then the repository gates.
5. After an explicitly authorized push, wait for Sonar analysis of that
   revision, then run the all-rule PR audit. Do not check off remediation before
   that analysis completes.
6. After merge and main analysis, run the main audit and update the baseline.
