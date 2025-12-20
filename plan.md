# Frontend memoization + update-depth scan

## Redundant memoization candidates

- `frontend/src/App.tsx:53`-`frontend/src/App.tsx:75`: multiple `useCallback` wrappers depend on the entire `viewState` object or `appLogsPanel`. Since those objects likely change on any context update, the callbacks are recreated anyway; memoization does not buy referential stability here.

- `frontend/src/shared/components/tables/hooks/useGridTableHeaderRow.tsx:28`: `useMemo` wraps JSX but depends on many functions/props that are commonly re-created each render in GridTable; the memo is likely invalidated every render, so it may be redundant.

- `frontend/src/shared/components/tables/hooks/useGridTableRowRenderer.tsx:69`: `useCallback` depends on large, frequently changing inputs (e.g., `columnRenderModelsWithOffsets`), so the callback is re-created each render; may be unnecessary noise unless upstream stabilizes those inputs.

- `frontend/src/shared/components/ResourceLoadingBoundary.tsx:23`: `useMemo` for `shouldShowSpinner` is a trivial boolean computation; likely not worth memoization.

- `frontend/src/shared/components/tables/hooks/useFrameSampler.ts:36`: the `useMemo` blocks for `defaultLogResults` and the window function fallbacks are simple and could be local variables; memoization adds complexity without clear perf benefit.

- `frontend/src/ui/layout/AppLayout.tsx:62`: `handleAboutClose` uses `useCallback` with the entire `viewState` object as a dependency; this callback is recreated whenever any view state changes, so memoization provides little stability.

- `frontend/src/ui/layout/Sidebar.tsx:80`: `resourceViews` is a static array wrapped in `useMemo([])`; could be module-level constant instead of runtime memoization.

- `frontend/src/ui/layout/Sidebar.tsx:95`: `namespaceViews` is another static array wrapped in `useMemo([])`; same as above.

- `frontend/src/components/content/AppLogsPanel/AppLogsPanel.tsx:29`: log-level option arrays and defaults (`LOG_LEVEL_BASE_OPTIONS`, `LOG_LEVEL_OPTIONS`, `ALL_LEVEL_VALUES`, `DEFAULT_LOG_LEVELS`) are all memoized but are static constants; could be defined once at module scope.

- `frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelKind.ts:26`: `useMemo` for `objectKind`, `scopeNamespace`, `detailScope`, and `helmScope` are simple string transforms; memoization adds little value for primitives.

- `frontend/src/modules/object-panel/components/ObjectPanel/Details/useUtilizationData.ts:25`: `useMemo` for `hasUtilization` boolean is trivial; inline computation is simpler.

- `frontend/src/modules/object-panel/components/ObjectPanel/Yaml/YamlTab.tsx:182`: `activeYaml` is a simple ternary string; `useMemo` offers little benefit here.

## Potential maximum update depth risks

- `frontend/src/shared/components/tables/useGridTableFilters.ts:92`: effect syncs `filters.initial` into local state without an equality guard. If a caller passes a fresh `filters.initial` object each render, this will call `setInternalFilters` on every render and can lead to a render loop. Consider memoizing `filters.initial` in callers or checking `areFilterStatesEqual` before setting.

- `frontend/src/shared/components/tables/hooks/useColumnVisibilityController.ts:34`: effect mirrors `columnVisibility` into local state whenever `columnVisibility` changes. If a parent passes a new object each render (even if values are unchanged), this can trigger repeated updates and, in the worst case, update-depth errors. A shallow equality check or memoized prop would avoid the loop.
