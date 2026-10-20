import { describe, expect, it } from 'vitest';
import { shouldShowActiveClusterAuthFailure } from './workspace';

describe('Global workspace shell isolation', () => {
  it('does not project the foreground cluster auth overlay over Global views', () => {
    expect(shouldShowActiveClusterAuthFailure(true, 'global')).toBe(false);
    expect(shouldShowActiveClusterAuthFailure(true, 'cluster')).toBe(true);
    expect(shouldShowActiveClusterAuthFailure(true, 'namespace')).toBe(true);
    expect(shouldShowActiveClusterAuthFailure(false, 'cluster')).toBe(false);
  });
});
