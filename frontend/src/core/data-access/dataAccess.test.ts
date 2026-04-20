import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getBrokerReadDiagnosticsSnapshot,
  resetBrokerReadDiagnosticsForTesting,
} from '@/core/read-diagnostics';

const hoisted = vi.hoisted(() => ({
  fetchScopedDomain: vi.fn(),
  triggerManualRefreshForContext: vi.fn(),
  getAutoRefreshEnabled: vi.fn(),
}));

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: {
    fetchScopedDomain: (...args: unknown[]) => hoisted.fetchScopedDomain(...args),
    triggerManualRefreshForContext: (...args: unknown[]) =>
      hoisted.triggerManualRefreshForContext(...args),
  },
}));

vi.mock('@/core/settings/appPreferences', () => ({
  getAutoRefreshEnabled: () => hoisted.getAutoRefreshEnabled(),
}));

import {
  isDataAccessBlocked,
  requestContextRefresh,
  requestData,
  requestRefreshDomain,
} from './dataAccess';

describe('dataAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBrokerReadDiagnosticsForTesting();
    hoisted.fetchScopedDomain.mockResolvedValue(undefined);
    hoisted.triggerManualRefreshForContext.mockResolvedValue(undefined);
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

  it('executes generic cluster-data reads through the shared request path', async () => {
    const read = vi.fn().mockResolvedValue(['alpha', 'beta']);

    await expect(
      requestData({
        resource: 'target-ports',
        reason: 'user',
        read,
      })
    ).resolves.toEqual({
      status: 'executed',
      data: ['alpha', 'beta'],
    });

    expect(read).toHaveBeenCalledTimes(1);
  });

  it('records diagnostics for blocked and executed cluster-data reads', async () => {
    hoisted.getAutoRefreshEnabled.mockReturnValue(false);

    await requestData({
      resource: 'namespaces',
      reason: 'startup',
      adapter: 'refresh-domain',
      label: 'Namespaces',
      scope: 'cluster:alpha',
      read: vi.fn(),
    });

    hoisted.getAutoRefreshEnabled.mockReturnValue(true);
    await requestData({
      resource: 'query-permissions',
      reason: 'startup',
      adapter: 'permission-read',
      label: 'Query Permissions',
      scope: 'cluster:alpha',
      read: vi.fn().mockResolvedValue([]),
    });

    const snapshot = getBrokerReadDiagnosticsSnapshot();
    expect(snapshot).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          broker: 'data-access',
          resource: 'namespaces',
          label: 'Namespaces',
          adapter: 'refresh-domain',
          reason: 'startup',
          blockedCount: 1,
          lastStatus: 'blocked',
          lastScope: 'cluster:alpha',
          recentScopes: ['cluster:alpha'],
        }),
        expect.objectContaining({
          broker: 'data-access',
          resource: 'query-permissions',
          label: 'Query Permissions',
          adapter: 'permission-read',
          reason: 'startup',
          successCount: 1,
          lastStatus: 'success',
          lastScope: 'cluster:alpha',
          recentScopes: ['cluster:alpha'],
        }),
      ])
    );
  });

  it('routes user context refreshes through the shared refresh wrapper', async () => {
    await expect(requestContextRefresh({ reason: 'user' })).resolves.toEqual({
      status: 'executed',
      blockedReason: undefined,
    });

    expect(hoisted.triggerManualRefreshForContext).toHaveBeenCalledTimes(1);
  });
});
