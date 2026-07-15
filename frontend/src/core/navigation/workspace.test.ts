import { describe, expect, it } from 'vitest';
import { shouldShowActiveClusterAuthFailure, shouldSyncClusterNavigationTarget } from './workspace';

describe('Global workspace shell isolation', () => {
  it('does not project the foreground cluster auth overlay over Global views', () => {
    expect(shouldShowActiveClusterAuthFailure(true, 'global')).toBe(false);
    expect(shouldShowActiveClusterAuthFailure(true, 'cluster')).toBe(true);
    expect(shouldShowActiveClusterAuthFailure(true, 'namespace')).toBe(true);
    expect(shouldShowActiveClusterAuthFailure(false, 'cluster')).toBe(false);
  });

  it('stages cluster navigation silently until Global is exited', () => {
    expect(shouldSyncClusterNavigationTarget('cluster-a', 'cluster-a', 'global')).toBe(false);
    expect(shouldSyncClusterNavigationTarget('cluster-a', 'cluster-a', 'cluster')).toBe(true);
    expect(shouldSyncClusterNavigationTarget('cluster-b', 'cluster-a', 'cluster')).toBe(false);
  });
});
