# Role and RoleBinding object-map support

## Contract

Add Role and RoleBinding nodes to namespace and object maps. RoleBindings link
to their namespaced Role or cluster-scoped ClusterRole and to ServiceAccount
subjects using the existing RBAC facts. Keep complete cluster/GVK/object refs,
permission gates, and existing ClusterRoleBinding behavior.

The producer is each kind's registry descriptor. The ingest manager registers
node projectors before starting reflectors; the object-map snapshot consumes
those projected rows after catalog seeding. Frontend consumers are the shared
Open Map action controller, object-panel tab/scope helpers, and generic map
model/renderer. Shared edge projection stays in the leaf objectmapspec package
to avoid kind-to-kind or snapshot-to-kind import cycles. No readiness policy or
wire shape changes are needed.

## Acceptance and evidence

| Criterion | Status | Evidence |
| --- | --- | --- |
| Namespace and object snapshots contain Role/RoleBinding nodes and RBAC links | passed | `TestObjectMapNamespacedRBACRelationships`; initial run failed with missing seeds and one namespace node instead of three, then passed with the collectors/edges registered |
| Same-name objects retain namespace/cluster identity; both roleRef kinds and cross-namespace ServiceAccounts resolve correctly | passed | `TestObjectMapNamespacedRBACRelationships`, `TestObjectMapRoleBindingReferencesClusterRoleAndCrossNamespaceSubject`; focused snapshot run passed |
| Denied Roles/RoleBindings are skipped with warnings; permitted resources remain available | passed | `TestObjectMapNamespacedRBACPermissionDenial`; both denial subtests passed |
| Ingest registration supplies new nodes and edges | passed | `TestIngestObjectMapProjectorNamespacedRBAC` checks production projector output; native app checks below establish live ingest-to-renderer delivery |
| Open Map and panel Map tabs accept complete Role/RoleBinding references | passed | `objectPanelRef.test.ts`, `useObjectPanelTabs.test.tsx`, `NsViewRBAC.test.tsx`: six new cases failed before the allowlist change; all 51 targeted tests passed afterward |
| Rendered map/navigation check | passed | Native Wails dev app: RoleBinding row Open Map displayed RoleBinding, Role, ServiceAccount and two links; Role row Open Map displayed Role and binding with one link; namespace map's kind list included both Role and RoleBinding |
| Coverage | passed | Backend coverage task passed; frontend coverage task rerun passed all 4,858 tests; directly affected file coverage is recorded below |
| Changed-function complexity | passed | Pinned gocognit: shared edge helper 3, both binding adapters 1, new status functions 0; collector List callbacks contain one unnested conditional, Status callbacks have no branches; frontend Biome complexity check passed (allowlist-only production edit) |
| Prerelease and final diff inspection | passed | Prerelease retry exited 0: formatting, bindings, vet/staticcheck, backend race tests, frontend checks/typecheck/tests, Knip, Trivy; final `git diff --check` passed and the worktree was inspected |

Automated snapshot tests replace the Kubernetes API with a fake client. Frontend
tests replace native navigation callbacks. These do not establish live cluster
behavior; rendered evidence is tracked separately.

## Validation detail

- `mise exec -- go test ./backend/refresh/snapshot -run ObjectMap -count=1` passed,
  including existing ClusterRole/ClusterRoleBinding relationships.
- Focused resource, shared-edge, and system projector tests passed.
- `mise exec -- go generate ./backend` passed without generated-file changes.
- Both repository coverage tasks were run. The first frontend coverage run timed
  out after five seconds in the existing `rejects a renamed Error.message value`
  test while backend coverage was also running. The isolated rerun passed all
  517 files / 4,858 tests without changing that test or its timeout.
- Supplemental cross-package coverage exercised the actual snapshot and ingest
  consumers (`-coverpkg` for role, rolebinding, clusterrolebinding, objectmapspec).
  New Role/RoleBinding collectors each covered 4/5 statements (80%; lister-error
  returns unexecuted); new status functions and RoleBinding edges were 100%;
  shared binding edges 100%; changed ClusterRoleBinding adapter 80%.
  `objectPanelRef.ts` measured 96.51% statements / 95.34% branches.
- Standalone Playwright reached the emitted Vite URL, but it could not load
  kubeconfigs through the browser runtime. Native computer use then exercised
  the running `Luxury Yacht.dev.app` at `wails://localhost/`, including a canvas
  screenshot confirming the RoleBinding-to-Role/ServiceAccount graph. No cluster
  resources were created or edited.
- Complexity evidence is local. The working branch is `main`; these uncommitted
  changes have no pushed PR revision or corresponding Sonar analysis.
- The first prerelease run passed backend race tests, then Biome attempted to
  parse generated HTML coverage reports under `frontend/coverage` and failed.
  Reports were moved to `/tmp/role-map-frontend-coverage-report` before retrying;
  the tracked-file diff remained limited to this task's changes.
- The full prerelease retry passed; Trivy reported zero configured high/critical
  vulnerabilities for `frontend/package-lock.json` and `go.mod`. Command output:
  `/tmp/role-map-prerelease-retry.log`. No release or PR was created.
