# Custom-resource ingestion completion record

Status: backend corrections, focused checks and the final repository gate
passed; required native verification remains outstanding. Do not treat automated
coverage as proof of the rendered workflows below.

## Durable contracts

Ownership, discovery, publication, permission diagnostics and full-sync policy
live in [catalog](../architecture/catalog.md),
[data layer](../architecture/data-layer.md),
[namespace scope](../architecture/namespace-scope.md),
[refresh system](../architecture/refresh-system.md) and
[large data producers](../architecture/large-data-producers.md).
This record holds only completion evidence and unresolved checks.

## Acceptance evidence

| Contract or workflow | Status | Evidence and limits |
| --- | --- | --- |
| Catalog-backed Custom views retain navigation, settings IDs, page hydration and export | Passed automated; rendered pending | Surviving frontend catalog/custom-view suites; actual view checks remain below. |
| One generation-owned dynamic watch; catalog membership, cache invalidation and stream notification | Passed automated | `TestSubsystemOwnsOneBelowThresholdCustomResourceWatch` and `TestCatalogCustomResourceWatchReconcilesTableMembership` use production owners with fake Kubernetes API clients. |
| Cluster identity, served-version/scope/UID replacement, stale-event rejection and shutdown | Passed automated | Ingest and catalog lifecycle suites. They do not prove simultaneous native cluster switching. |
| Private full-sync publication, independent LIST timeouts/failures and unchanged-source admission | Passed automated | `TestCatalogReplacementStaysPrivateUntilPublication`, LIST isolation tests and dynamic admission regressions. API timeout tests use real HTTP servers. |
| CRD establishment triggers collection; unestablished Add does not | Passed regression | `TestCRDAddWaitsForEstablishmentBeforeRecollection` failed before the gate and passed after it. Existing new-CRD regression also passes. |
| LIST-only rows remain visible and denied WATCH partitions reach diagnostics | Passed regression | `TestDeniedDynamicWatchRemainsVisibleToReadiness`, `TestPromotedSourcePreservesListOnlyNamespaceRows`, `TestWatchDenialWarnsWithoutDiscardingCompleteListRows`, and DiagnosticsPanel's retained-count/warning test cover producer and consumer separately. Frontend store/API inputs are mocked. |
| Full-sync cost at large object count | Passed measurement, bounded fixture | Real local Kind API, 10,336 objects, 64 resource types: 155 ms full pass, 385 ms update-to-publication, 29 non-CRD LISTs, 64 permission reviews, two discovery requests, no CR LIST. Method and limits are retained in large-data-producers. No aggregated extension API was installed. |
| Browse, cluster/namespace Custom and family views: rows, counts/facets, external mutations, details/YAML | Blocked native | Mac access is available, but switching the app to disposable clusters and resetting saved layout was rejected by automatic approval review pending explicit permission. The request remains unanswered; live settings were not modified. |
| Simultaneous cluster switching, disconnect/reconnect and governor Cold/re-warm | Pending native | Backend lifecycle/governor tests do not replace this consumer workflow. |
| Saved settings, filtering/paging and export in actual views | Blocked native | Same pending temporary-settings approval. |

## Current validation, 2026-09-22

- Affected backend package suites passed under `go test -race`: objectcatalog,
  ingest, snapshot, system and resourcestream. An initial run was interrupted by
  a compile error in the temporary measurement harness; the corrected catalog
  run passed. The harness was removed after the real-cluster measurement.
- Focused DiagnosticsPanel and browseCatalogData suites passed: two files,
  39 tests. No frontend production code changed in these review corrections.
- `mise exec -- wails3 task test:backend-coverage` passed: catalog 89.8%, ingest
  85.4%, snapshot 83.0%, system 80.4%. Stream package coverage is 70.0%; its
  changes here are comment/whitespace cleanup only. New partition readiness and
  watch-warning functions are 100%; changed CRD invalidation is 87.5%, dynamic
  entry preparation 100%, and snapshot stats 83.3%.
- Pinned gocognit v1.2.1 reports at most 10 for production functions changed in
  these review corrections (target 12). No complexity suppression was added.
- Final `mise exec -- wails3 task qc:prerelease` passed, exit 0, including Go
  race tests, frontend tests, bindings, lint/typecheck, Knip and Trivy. The gate
  reported no formatting changes. Only this completion record changed afterward;
  documentation and whitespace checks were rerun.
- `gh pr view` found no PR for `custom-resources-refactor`. Remote Sonar and
  Windows/Linux UI remain unrun. The two existing commits remain titled `wip`;
  no Git history rewrite or commit of these corrections has been performed.

## Separate restricted-startup limitation

An earlier real-cluster probe denied built-in ReplicaSet, HPA and Event watches.
The catalog did not finish startup even though its Widget source was ready.
Granting those baseline permissions allowed the custom-resource partition checks
to proceed. The unchanged `waitForCatalogInformerCaches` path waits on raw shared
informer sync. This remains unresolved; custom-resource permission tests do not
establish startup for arbitrary restricted identities.

## Remaining completion steps

1. Resolve the pending approval for temporary native app settings/layout changes,
   then exercise the blocked workflows with disposable clusters and restore app
   state. Alternatively, the user must explicitly accept the unverified risk.
2. Resolve any runtime failures and run affected checks and the final gate.
3. Retitle the two `wip` commits when Git history editing is explicitly authorized.
4. Delete this temporary record after required verification or explicit risk
   acceptance. Durable contracts and the bounded performance result are already
   in existing architecture documentation.

## Cleanup

Both disposable Kind clusters (`codex-custom-ui-a` and `codex-custom-ui-b`) were
deleted after measurement; `kind get clusters` reported none. Their temporary
kubeconfigs were removed. No native app or dev server was launched in this review
pass, no app settings/layout files were changed, and `lsof` found no listener on
port 9245. Native verification will need fresh disposable fixtures after approval.
