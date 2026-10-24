/**
 * frontend/src/test-utils/refreshScope.ts
 *
 * Joins a cluster id and a scope tail into a refresh scope string for test
 * fixtures. Production code builds scopes only with the codec
 * (core/refresh/scopeSelector.ts); tests use this to state the exact wire
 * string they expect.
 */
export const testScope = (clusterId: string, tail = ''): string => `${clusterId}|${tail}`;
