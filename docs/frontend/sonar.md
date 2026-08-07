# Sonar remediation contract

SonarQube Cloud is the authority for repository S3776 findings. The project uses
Sonar Automatic Analysis rather than a checked-in scanner; local analysis is an
early warning, not completion evidence.

## TypeScript S3776 baseline

`frontend/scripts/typescript-s3776-baseline.json` records every open
`typescript:S3776` issue key, function identity, path, line, and reported score
from one completed `main` analysis.

The baseline is monotonic:

- a new issue key fails the audit;
- an increased score on a retained key fails the audit;
- lower scores and closed keys pass;
- updating the baseline can only lower retained scores or remove closed keys;
- the baseline never auto-accepts a new or increased issue.

Audit the current main branch from the repository root:

```sh
mise exec -- npm run sonar:audit:main --prefix frontend
```

After a pull-request analysis completes, audit every open/confirmed new-code
issue, not only S3776:

```sh
mise exec -- npm run sonar:audit --prefix frontend -- --pull-request 123
```

The PR audit is intentionally all-rule. A complexity refactor is not successful
if it replaces S3776 with a correctness, accessibility, duplication, or other
maintainability issue.

After the remediation is merged and a newer `main` analysis confirms the
expected reduction, update the baseline explicitly:

```sh
mise exec -- npm run sonar:baseline:update --prefix frontend
```

Review the JSON diff before committing it. Do not update from a feature branch,
from a stale analysis, or while the audit reports a new/increased issue.

## Local Biome signal

The installed Biome exposes
`lint/complexity/noExcessiveCognitiveComplexity`, which implements a cognitive
complexity algorithm with a default maximum of 15. Check one touched source
while refactoring:

```sh
cd frontend
mise exec -- npx biome lint src/path/to/file.ts \
  --only=lint/complexity/noExcessiveCognitiveComplexity
```

The parity spike at revision `b0d3344b976bf451f5a71ab6344599ae3e0754d9`
found the same location for 90 of Sonar's 91 TypeScript findings, but it reported
224 production findings compared with Sonar's 91. Only 5 matching locations had
the exact same score, and only 25 were within three points. Biome also missed
Sonar's `buildCatalogSummary` finding. Therefore:

- use Biome directionally while editing a function;
- target 12 or lower when Biome reports the touched function;
- do not infer Sonar closure from a Biome score;
- do not expand the Sonar inventory with Biome-only findings during this plan;
- wait for the completed Sonar analysis before checking off remediation.

## Required remediation loop

1. Record the Sonar key, score, owning contract, consumers, and directly affected
   coverage.
2. Add or confirm characterization cases before moving branches.
3. Refactor one responsibility at a time and rerun focused tests.
4. Run the local Biome signal for the touched function.
5. Run frontend check, typecheck, coverage, and the full prerelease gate.
6. Push the smallest reviewable batch and wait for Sonar.
7. Run the all-rule PR audit.
8. After merge and main analysis, run the monotonic main audit and update the
   baseline.

The live API check is not part of the offline frontend lint/test gate. Merge
enforcement belongs to the Sonar/GitHub status-check configuration; repository
scripts make the decision reproducible but cannot make an unprotected branch
require it.
