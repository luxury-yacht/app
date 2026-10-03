/**
 * frontend/src/core/refresh/streaming/containerLogsStreamScopeParams.ts
 *
 * Per-scope source selection the container-logs stream sends when it opens.
 * Container Logs writes it; the stream manager reads it for each request.
 *
 * This mirrors the panel-lifetime persistence used by logViewerPrefsCache:
 * scopes survive transient unmount/remount cycles caused by cluster
 * switching, but are explicitly evicted when the owning panel closes.
 */

export interface ContainerLogsStreamScopeParams {
  selectedFilters?: string[];
  matchNone?: boolean;
}

const cache = new Map<string, ContainerLogsStreamScopeParams>();

const normalize = (params: ContainerLogsStreamScopeParams): ContainerLogsStreamScopeParams => {
  const selectedFilters = Array.from(
    new Set(
      (params.selectedFilters ?? [])
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  );
  const next: ContainerLogsStreamScopeParams = {};
  if (selectedFilters.length > 0) {
    next.selectedFilters = selectedFilters;
  }
  if (params.matchNone === true) {
    next.matchNone = true;
  }
  return next;
};

const areEqual = (
  left: ContainerLogsStreamScopeParams,
  right: ContainerLogsStreamScopeParams
): boolean =>
  JSON.stringify(left.selectedFilters ?? []) === JSON.stringify(right.selectedFilters ?? []) &&
  (left.matchNone ?? false) === (right.matchNone ?? false);

export const getContainerLogsStreamScopeParams = (
  scope: string
): ContainerLogsStreamScopeParams | undefined => cache.get(scope);

export const setContainerLogsStreamScopeParams = (
  scope: string,
  params: ContainerLogsStreamScopeParams
): boolean => {
  const normalized = normalize(params);
  const previous = cache.get(scope) ?? {};
  if (Object.keys(normalized).length === 0) {
    cache.delete(scope);
    return !areEqual(previous, {});
  }
  if (areEqual(previous, normalized)) {
    return false;
  }
  cache.set(scope, normalized);
  return true;
};

export const clearContainerLogsStreamScopeParams = (scope: string): void => {
  cache.delete(scope);
};

export const resetContainerLogsStreamScopeParamsCacheForTesting = (): void => {
  cache.clear();
};
