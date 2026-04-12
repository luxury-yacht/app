/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/logStreamScopeParamsCache.ts
 *
 * Module-level cache of per-scope backend log stream filters.
 *
 * This mirrors the panel-lifetime persistence used by logViewerPrefsCache:
 * scopes survive transient unmount/remount cycles caused by cluster
 * switching, but are explicitly evicted when the owning panel closes.
 */

export interface LogStreamScopeParams {
  container?: string;
  selectedFilters?: string[];
}

const cache = new Map<string, LogStreamScopeParams>();

const normalize = (params: LogStreamScopeParams): LogStreamScopeParams => {
  const container = params.container?.trim() ?? '';
  const selectedFilters = Array.from(
    new Set(
      (params.selectedFilters ?? [])
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  );
  const next: LogStreamScopeParams = {};
  if (container) {
    next.container = container;
  }
  if (selectedFilters.length > 0) {
    next.selectedFilters = selectedFilters;
  }
  return next;
};

const areEqual = (left: LogStreamScopeParams, right: LogStreamScopeParams): boolean =>
  (left.container ?? '') === (right.container ?? '') &&
  JSON.stringify(left.selectedFilters ?? []) === JSON.stringify(right.selectedFilters ?? []);

export const getLogStreamScopeParams = (scope: string): LogStreamScopeParams | undefined =>
  cache.get(scope);

export const setLogStreamScopeParams = (scope: string, params: LogStreamScopeParams): boolean => {
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

export const clearLogStreamScopeParams = (scope: string): void => {
  cache.delete(scope);
};

export const resetLogStreamScopeParamsCacheForTesting = (): void => {
  cache.clear();
};
