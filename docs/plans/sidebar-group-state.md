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
