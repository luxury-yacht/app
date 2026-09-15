# Remember sidebar group expansion

## Accepted behavior

Remember expanded/collapsed state without adding controls. Four independent
values cover Cluster Resources, Cluster Extensions, Namespace Resources, and
Namespace Extensions. Cluster values apply to every cluster; namespace values
apply to every namespace in every cluster. Missing values default to collapsed.

## Ownership and ordering

Use the existing backend preference schema and `UpdateAppPreferences` path:
`PreferencesService` produces disk-backed defaults/current values;
`appPreferences` hydrates and publishes changes; the shared sidebar expansion
hook consumes them for cluster and namespace groups. Existing preference
broadcasts rehydrate peer renderers. These are global UI choices, not cluster
resource data. No cluster or object identity changes are needed.

Frontend mutations publish optimistically, persist, and use the existing error
reporting/rollback path on failure. Subscription setup must observe hydration
and changes from sibling groups. Keep dependencies one-way from UI to core
settings to backend API; core settings must not import sidebar components.
Preserve explicit resource-link navigation reveal and keyboard disclosure.

## Completion evidence

| Criterion | Status | Evidence |
| --- | --- | --- |
| Four collapsed defaults and independent disk persistence, including saving false | passed | `go test ./backend -run 'TestSidebarGroupExpansionPersistsIndependently\|TestAppSettingsSchemaCoversUpdateAppPreferenceKeys' -count=1` passed. The new persistence test first failed because the schema lacked the fields, then passed using a new service instance to read the saved file. |
| Shared namespace and cluster state with immediate sibling updates | passed | `Sidebar.test.tsx`: sibling namespace expansion first failed at the missing Autoscaling row, then passed; remount regression restores distinct cluster/namespace values after switching clusters. Real Sidebar and preference cache; cluster/catalog contexts mocked. |
| Hydration and persistence failure rollback | passed | `appPreferences.test.ts`: schema hydration, saved false, peer broadcast on success, optimistic notification and rollback on rejected persistence. Wails calls mocked. |
| Keyboard toggles and resource-link navigation | passed | `npm run test --prefix frontend -- src/ui/layout/Sidebar.test.tsx src/ui/layout/Sidebar.navigation.test.tsx src/core/settings/appPreferences.test.ts`: 102 tests passed. Navigation cases use real ViewStateProvider and ObjectPanelLink under StrictMode. |
| Rendered toggle, cluster/namespace switch, reload | pending | User will handle visual confirmation. Playwright at the running Vite URL `http://localhost:9245` returned 404 for `/wails/runtime`; native Computer Use was not approved. |
| Directly affected coverage | passed | Backend coverage task passed: `preferences_settings.go` 437/527 statements (82.92%), `preferences_settings_data.go` 127/141 (90.07%). Changed functions: `appSettingsFromFile` 100%, `saveAppSettings` 88.7%, `appPreferenceDescriptors` 96.6%. Frontend coverage task passed: 511 files / 4,684 tests; `appPreferences.ts` 456/479 statements (95.19%), `Sidebar.tsx` 275/285 (96.49%), `useSidebarGroupExpansion.ts` 15/15 (100%). Reports: `build/coverage/backend.coverage.out`, `/tmp/sidebar-group-frontend-coverage/coverage-summary.json`. |
| Local complexity and bindings | passed | Biome complexity-only lint with a temporary maximum of 12 passed on Sidebar, its expansion hook, and appPreferences. Pinned gocognit v1.2.1: changed Go functions score 0, 7, and 6. Wails generation processed 245 models; standalone TypeScript check passed. `gh pr view` reported no PR for `resources-extensions-state`, so no current PR Sonar findings were available. |
| Final prerelease gate and worktree inspection | passed | `mise exec -- wails3 task qc:prerelease` retry exited 0: formatting, generated bindings, vet/staticcheck, backend race tests, frontend lint/typecheck/tests, Knip, and Trivy. Final worktree inspection showed only the intended sidebar/settings/docs changes plus the pre-existing dependency edits. `git diff --check` passed. Log: `/tmp/sidebar-prerelease-rerun.log`. |

Existing unrelated changes at task start: frontend package manifests, `go.mod`,
`go.sum`, and `mise.toml`.

The first prerelease invocation passed Go formatting, bindings, vet,
staticcheck, and race tests, then failed because Biome parsed generated coverage
HTML (3,023 errors). Moved the 889 generated report files outside the source
tree. Read-only `npm run check --prefix frontend` then passed all 1,373 source
files without fixes. Automatic review initially rejected a gate rerun because
of the generated-file formatting count; it approved the retry after those
read-only checks and worktree inspection established its scope.

## Follow-up: Helm in Extensions

Move namespace Helm from Resources into Extensions, immediately after External
Secrets and before Prometheus Operator. The view registry owns grouping and order;
Sidebar filters that registry through discovery and all-namespaces availability.
Its keyboard navigation follows the rendered order. Existing route IDs, refresh
mapping, and namespace/cluster identity stay unchanged. No dependency or
production function changes are needed.

| Criterion | Status | Evidence |
| --- | --- | --- |
| Helm follows Extensions disclosure and keyboard order | passed | The final-order regression first failed because focus skipped Helm after External Secrets. After the registry move, keyboard focus follows External Secrets → Helm → Prometheus Operator, Helm activates in `cluster-a/default`, and collapsing Extensions hides it. All 97 tests in the six focused sidebar/navigation/Favorites/command-palette files passed; the latter two suites now expect the shared registry order. |
| Coverage and local complexity | passed | `mise exec -- wails3 task test:frontend-coverage`: 511 files / 4,685 tests passed. Statement coverage: view registry 12/12 (100%), Sidebar 275/285 (96.49%). Report preserved at `/tmp/helm-sidebar-final-coverage/coverage-summary.json` outside source lint scope. No production functions changed; Biome complexity-only lint passed on the registry. |
| Final gate and worktree inspection | passed | `mise exec -- wails3 task qc:prerelease` exited 0: formatting/bindings, vet/staticcheck, race tests, frontend lint/typecheck, all 4,685 frontend tests, Knip, and Trivy. Lint inspected 1,373 files with no fixes. Final diff is limited to the registry move, three affected test files, and this completion record; `git diff --check` passed. Log: `/tmp/helm-sidebar-prerelease.log`. |
| Visual placement | pending | User owns visual confirmation, per earlier instruction. |

## Follow-up: Open Cluster placement

With no clusters open, show the labelled Open Cluster button at the left. With
clusters open, show only its plus icon immediately after the last tab. Let the
tab strip shrink and scroll on overflow while reserving space for the button.
Restore the label after the final cluster closes; retain its accessible name,
tooltip, and open action throughout.

`KubeconfigContext` supplies the selected clusters and loading state. ClusterTabs
derives ordered tabs and owns the open button; shared Tabs owns scrolling,
overflow controls, and tab keyboard navigation. Keep the existing hydration gate,
height observer, selection, close, and drag ordering paths. This changes no
provider ordering, persistence, cluster identity, or dependencies.

| Criterion | Status | Evidence |
| --- | --- | --- |
| Open button transitions between empty and populated selection | passed | The new regression failed with the label still present after opening a cluster, then passed for empty → one → multiple → empty selections and the accessible open action. Real ClusterTabs and Tabs; cluster context and open callback mocked. Replaces the obsolete width-measurement test and retains the click assertion in the transition test. |
| Loading, selection, close, keyboard, and drag workflows | passed | `npm run test --prefix frontend -- src/ui/layout/ClusterTabs.test.tsx src/shared/components/tabs/Tabs.test.tsx`: 64 tests passed, including saved-selection loading, tab ordering, keyboard navigation, close, drag, and shared scrolling behavior. Shared overflow tests mock element measurements; they do not prove rendered placement. |
| Coverage and local complexity | passed | `mise exec -- wails3 task test:frontend-coverage`: 511 files / 4,684 tests passed. ClusterTabs statement coverage is 118/134 (88.05%), previously 148/163 (90.79%); removal of the label observer and its obsolete test reduced the measured surface. Report: `/tmp/open-cluster-coverage-report/coverage-summary.json`. TypeScript and Biome complexity-only lint with maximum 12 passed. `gh pr view` found no PR for `resources-extensions-state`, so no current PR Sonar findings were available. |
| Final gate and worktree inspection | passed | `mise exec -- wails3 task qc:prerelease` exited 0: formatting/bindings, vet/staticcheck, backend race tests, frontend lint/typecheck, all 4,684 frontend tests, Knip, and Trivy. Lint inspected 1,373 files with no fixes. Final diff is limited to ClusterTabs, its CSS and test, and this completion record; `git diff --check` passed. Log: `/tmp/open-cluster-prerelease.log`. |
| Rendered placement, overflow, and window resizing | pending | User owns visual confirmation, per earlier instruction. |

The first read-only lint attempt included generated coverage HTML after moving
the report failed across filesystem volumes. A cross-volume move succeeded;
the rerun checked all 1,373 source files with no fixes and exited 0. The report
was outside the frontend tree before starting the prerelease gate.
