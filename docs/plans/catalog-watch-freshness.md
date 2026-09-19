# Catalog watch freshness

Restore catalog-backed table freshness after Kubernetes custom-resource changes,
including deletion with finalizers, and cover the application wiring that allowed
an unrelated healthy stream to conceal stale catalog membership.

The existing per-cluster resource-stream manager owns permission-gated custom
informers. The catalog subscribes before its initial collection, reconciles
changed identities from those informers' current stores, publishes its query index,
and then signals catalog consumers through the existing coordinator bridge.
The dependency interface belongs to objectcatalog to avoid importing the stream
manager (which already consumes catalog updates). Callbacks only enqueue work;
catalog reconciliation never runs while holding the manager's locks.

Consumers are Browse, namespace/all-namespace and cluster custom-resource/family
tables, the diff object chooser, catalog-backed map identities, and finalizer
Attention findings. Gateway informer-backed catalog rows now have incremental
handlers. Dedicated resource domains keep their existing notifications.

## Completion evidence

| Criterion | Status | Evidence |
| --- | --- | --- |
| Real custom informer -> catalog query -> catalog signal, including finalizers and deletion | passed | `TestCatalogCustomResourceWatchReconcilesTableMembership` reproduced the failure before the fix and now passes; only Kubernetes clients replaced |
| Startup, cancellation, namespace/cluster isolation, replacement identity and concurrent sync | passed | Startup deletion is synchronized with the initial LIST in the application composition test; `TestQueuedCustomChangeUsesCurrentIdentityAndRecoversUnreadySource` and `TestCatalogSourceReadsOnlyAuthorizedCurrentWatchState` cover replacement, retention, recovery, RBAC and teardown |
| Gateway catalog updates share existing informers | passed | `TestGatewayInformerChangesUpdateCatalog` covers add/update/delete for all eight Gateway catalog registry kinds; the regression failed before the handlers were connected |
| Production views reconcile changes through the registered catalog source | passed | `catalogFreshness.integration.test.tsx` mounts `NsViewArgoCD`, `NsViewCustom` and `BrowseView` with their real persistence, table adapters, `ResourceInventoryTable`, `GridTable`, catalog hooks, store, orchestrator and default domain registration. An Application exercises the Argo CD family query; ExternalSecrets exercise namespace Custom and Browse. External create/update/delete changes update rendered names, label values and counts while the stream is healthy; another cluster retains its rows and values. Backend reads, Wails transport and unrelated shell/action contexts are replaced; no test-owned refresh registration or table/hook stub supplies the connection |
| Frontend regression detects disconnected registration and consumption | passed | Isolated Vite transforms remove catalog streaming registration or prevent the catalog hook from observing signal changes. All three view cases fail: missing registration fails stream-health admission, and missing consumption leaves the created row absent. The unmodified production path passes all three cases |
| Strengthened frontend coverage | passed | Running only the old versus new integration against the same seven production files increases statement coverage from 182/512 (35.54%) to 309/512 (60.35%). This measures the integration's reach, not whole-suite coverage; the follow-up changes tests and documentation only, with no new production functions |
| Latest repository gate after production-view coverage | passed | `GOCACHE=/tmp/luxury-yacht-go-build STATICCHECK_CACHE=/tmp/luxury-yacht-staticcheck mise exec -- wails3 task qc:prerelease` exited 0 on 2026-09-19 after the final three-view regression: docs, formatting, generated bindings, vet/staticcheck, backend race tests, frontend lint/typecheck, 524 frontend files / 5,049 tests, knip and Trivy. Post-gate inspection shows only the regression test and this completion record changed |
| Focused tests, coverage, complexity | passed | Focused frontend suite: 88 tests passed; strengthened healthy-stream integration and TypeScript check also passed. `wails3 task test:backend-coverage` passed: affected production functions cover 269/290 statements (92.8%). Pinned gocognit 1.2.1: all 22 changed/new production functions score at most 12. These are local measurements, not remote Sonar analysis |
| Final prerelease gate and worktree inspection | passed | `GOCACHE=/tmp/luxury-yacht-go-build STATICCHECK_CACHE=/tmp/luxury-yacht-staticcheck mise exec -- wails3 task qc:prerelease` exited 0 on 2026-09-19: docs, formatting, generated bindings, vet/staticcheck, backend race tests, frontend lint/typecheck, 524 frontend files / 5,047 tests, knip and Trivy. Inspected the post-gate worktree; changes remain within this fix |
| Runtime table validation | passed | User confirmed on 2026-09-19: “the table data is properly updated in both the Argo CD view and the Browse view.” Native Computer Use was unavailable and browser preview had no Wails backend bridge; the runtime result is user-verified |

## Recurrence protection and limits

On 2026-09-19, isolated Go overlays deliberately removed each production
connection without modifying the worktree. Removing `CustomResourceSource`
assignment failed `TestCatalogCustomResourceWatchReconcilesTableMembership` at
the catalog signal assertion. Removing Gateway handler registration failed all
eight cases of `TestGatewayInformerChangesUpdateCatalog`. Running both tests
against the unmodified worktree then passed. These checks establish detection of
the two missing backend connections, not every possible freshness regression.

The frontend integration now exercises the production views and their default
domain registration; the user's native checks provide separate runtime evidence.
The regression remains in the normal frontend suite, which the existing
[release workflow](../../.github/workflows/release.yml) runs alongside the backend
suite before its build jobs proceed. No additional CI workflow or repository-rule
change is part of this fix. Regression coverage closes the identified wiring gap;
it does not establish that every possible freshness failure is covered.

Durable acceptance requirements now live in
[data freshness](../architecture/data-freshness.md#required-evidence-for-resource-source-changes),
with entry points in the table-change checklist and testing standard. Those
requirements guide future changes; documentation alone cannot enforce them.

## PR 356 Sonar remediation

The all-rule PR audit on revision `61e44b3d0d534d3fdcc668d8a432cae14a9b8186`
reported four findings (none were cognitive-complexity findings):

| Sonar key | Rule | Local remediation |
| --- | --- | --- |
| `AaC7DovoMe4CmcK0j-G-` | `go:S1186` | Explain the empty join callback when reactive updates are disabled |
| `AaC7DovoMe4CmcK0j-G_` | `godre:S8188` | Move notifier cancellation into `runLoop`, with deferred cancellation ordered before joining the worker |
| `AaC7DovUMe4CmcK0j-G9` | `go:S1186` | Explain the empty unsubscribe callback when no custom-resource source exists |
| `AaC7DosSMe4CmcK0j-G8` | `go:S1186` | Explain the empty unsubscribe callback when the manager is stopped or the listener is absent |

`runLoop` owns the notifier lifetime. The worker still registers handlers
asynchronously, reconciles catalog changes, removes its handlers and completes
before catalog retirement. The existing custom-source and catalog consumers do
not change, and no dependency is added. Characterization tests for live catalog
updates, startup deletion, parent cancellation, blocked registration and source
retirement passed before the refactor.

| Remediation evidence | Status | Evidence |
| --- | --- | --- |
| Focused tests after ownership refactor | pending | Rerun the existing characterization cases |
| Affected coverage and local complexity | pending | Measure the changed production functions |
| Final repository gate | pending | Run `qc:prerelease` and inspect the worktree |
| Sonar closure on the corrected revision | pending | Requires an explicitly authorized push and a completed analysis of that revision; the current remote analysis still describes `61e44b3d` |
