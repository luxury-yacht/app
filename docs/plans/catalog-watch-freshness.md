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
| Catalog consumer removes deleted membership after signal | passed | `catalogFreshness.integration.test.tsx` uses the real stream manager, healthy-stream state, orchestrator, query hook and hydration merge; other-cluster membership remains present. The test replaces backend boundaries, explicitly registers the catalog domain and mounts a hook harness; it does not automate the production view binding |
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

The frontend hook integration and the user's native checks provide different
evidence. Automatic coverage of the production view/domain registration remains
a limitation of this regression suite. The checked-in release workflow runs on
tag pushes or manual dispatch; repository-host branch protection and external
required checks have not been inspected, so no merge-enforcement claim is made.

Durable acceptance requirements now live in
[data freshness](../architecture/data-freshness.md#required-evidence-for-resource-source-changes),
with entry points in the table-change checklist and testing standard. Those
requirements guide future changes; documentation alone cannot enforce them.
