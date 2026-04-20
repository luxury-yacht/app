import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  fetchScopedDomain: vi.fn(),
  getAutoRefreshEnabled: vi.fn(),
}));

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: {
    fetchScopedDomain: (...args: unknown[]) => hoisted.fetchScopedDomain(...args),
  },
}));

vi.mock('@/core/settings/appPreferences', () => ({
  getAutoRefreshEnabled: () => hoisted.getAutoRefreshEnabled(),
}));

import { isDataAccessBlocked, requestRefreshDomain } from './dataAccess';

describe('dataAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.fetchScopedDomain.mockResolvedValue(undefined);
    hoisted.getAutoRefreshEnabled.mockReturnValue(true);
  });

  it('blocks startup requests when auto-refresh is disabled', async () => {
    hoisted.getAutoRefreshEnabled.mockReturnValue(false);

    await expect(
      requestRefreshDomain({
        domain: 'namespaces',
        scope: 'cluster:alpha',
        reason: 'startup',
      })
    ).resolves.toEqual({
      status: 'blocked',
      blockedReason: 'auto-refresh-disabled',
    });
    expect(hoisted.fetchScopedDomain).not.toHaveBeenCalled();
    expect(isDataAccessBlocked('startup', false)).toBe(true);
  });

  it('blocks background requests when auto-refresh is disabled', async () => {
    hoisted.getAutoRefreshEnabled.mockReturnValue(false);

    await expect(
      requestRefreshDomain({
        domain: 'cluster-overview',
        scope: 'cluster:alpha',
        reason: 'background',
      })
    ).resolves.toEqual({
      status: 'blocked',
      blockedReason: 'auto-refresh-disabled',
    });
    expect(hoisted.fetchScopedDomain).not.toHaveBeenCalled();
  });

  it('allows user requests when auto-refresh is disabled', async () => {
    hoisted.getAutoRefreshEnabled.mockReturnValue(false);

    await expect(
      requestRefreshDomain({
        domain: 'namespaces',
        scope: 'cluster:alpha',
        reason: 'user',
      })
    ).resolves.toEqual({
      status: 'executed',
    });
    expect(hoisted.fetchScopedDomain).toHaveBeenCalledWith('namespaces', 'cluster:alpha', {
      isManual: true,
    });
  });

  it('runs startup requests as non-manual refreshes when auto-refresh is enabled', async () => {
    await expect(
      requestRefreshDomain({
        domain: 'cluster-overview',
        scope: 'cluster:alpha',
        reason: 'startup',
      })
    ).resolves.toEqual({
      status: 'executed',
    });
    expect(hoisted.fetchScopedDomain).toHaveBeenCalledWith('cluster-overview', 'cluster:alpha', {
      isManual: false,
    });
  });
});
