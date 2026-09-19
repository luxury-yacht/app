/**
 * frontend/src/core/data-access/dataAccess.test.ts
 *
 * Verifies brokered data access and refresh-domain lifecycle coordination.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getBrokerReadDiagnosticsSnapshot,
  resetBrokerReadDiagnosticsForTesting,
} from '@/core/read-diagnostics';

const hoisted = vi.hoisted(() => ({
  fetchScopedDomain: vi.fn(),
  setScopedDomainEnabled: vi.fn(),
  acquireScopedDomainLease: vi.fn(),
  releaseScopedDomainLease: vi.fn(),
  triggerManualRefreshForContext: vi.fn(),
  getScopedDomainState: vi.fn(),
  getAutoRefreshEnabled: vi.fn(),
}));

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: {
    fetchScopedDomain: (...args: unknown[]) => hoisted.fetchScopedDomain(...args),
    acquireScopedDomainLease: (...args: unknown[]) => hoisted.acquireScopedDomainLease(...args),
    releaseScopedDomainLease: (...args: unknown[]) => hoisted.releaseScopedDomainLease(...args),
    setScopedDomainEnabled: (...args: unknown[]) => hoisted.setScopedDomainEnabled(...args),
    triggerManualRefreshForContext: (...args: unknown[]) =>
      hoisted.triggerManualRefreshForContext(...args),
  },
}));

vi.mock('@/core/refresh/store', () => ({
  getScopedDomainState: (...args: unknown[]) => hoisted.getScopedDomainState(...args),
}));

vi.mock('@/core/settings/appPreferences', () => ({
  getAutoRefreshEnabled: () => hoisted.getAutoRefreshEnabled(),
}));

import {
  acquireRefreshDomainLease,
  isDataAccessBlocked,
  releaseRefreshDomainLease,
  requestContextRefresh,
  requestData,
  requestRefreshDomain,
  requestRefreshDomainState,
} from './dataAccess';

describe('dataAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBrokerReadDiagnosticsForTesting();
    hoisted.fetchScopedDomain.mockResolvedValue(undefined);
    hoisted.getScopedDomainState.mockReturnValue({ status: 'ready', data: null });
    hoisted.triggerManualRefreshForContext.mockResolvedValue(undefined);
    hoisted.getAutoRefreshEnabled.mockReturnValue(true);
  });

  it.each([
    { demand: 'snapshot' as const, preserveState: false, expected: undefined },
    { demand: 'snapshot' as const, preserveState: true, expected: { preserveState: true } },
    {
      demand: 'query' as const,
      preserveState: false,
      expected: { preserveState: false, demand: 'query' },
    },
    {
      demand: 'query' as const,
      preserveState: true,
      expected: { preserveState: true, demand: 'query' },
    },
  ])(
    'balances $demand demand with preserveState=$preserveState across lease acquisition and release',
    ({ demand, preserveState, expected }) => {
      const lease = {
        domain: 'pods' as const,
        scope: 'cluster-a|namespace:prod',
        demand,
        preserveState,
      };
      acquireRefreshDomainLease(lease);
      releaseRefreshDomainLease(lease);
      expect(hoisted.acquireScopedDomainLease).toHaveBeenCalledWith(
        lease.domain,
        lease.scope,
        expected
      );
      expect(hoisted.releaseScopedDomainLease).toHaveBeenCalledWith(
        lease.domain,
        lease.scope,
        expected
      );
    }
  );

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
      streamSignal: false,
      correlationId: 'broker-read-1',
    });
  });

  it('runs foreground activation immediately without classifying it as a manual refresh', async () => {
    hoisted.getAutoRefreshEnabled.mockReturnValue(false);

    await expect(
      requestRefreshDomain({
        domain: 'namespaces',
        scope: 'cluster:alpha',
        reason: 'foreground',
      })
    ).resolves.toEqual({
      status: 'executed',
    });
    expect(hoisted.fetchScopedDomain).toHaveBeenCalledWith('namespaces', 'cluster:alpha', {
      isManual: false,
      streamSignal: false,
      correlationId: 'broker-read-1',
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
      streamSignal: false,
      correlationId: 'broker-read-1',
    });
  });

  it('owns enable, fetch, read, and cleanup ordering for one-shot scoped refresh reads', async () => {
    const state = {
      status: 'ready',
      data: { items: [] },
      scope: 'cluster:alpha|limit=2',
    };
    hoisted.getScopedDomainState.mockReturnValue(state);

    await expect(
      requestRefreshDomainState({
        domain: 'catalog',
        scope: 'cluster:alpha|limit=2',
        reason: 'user',
        preserveState: true,
      })
    ).resolves.toEqual({
      status: 'executed',
      data: state,
    });

    expect(hoisted.acquireScopedDomainLease).toHaveBeenCalledWith(
      'catalog',
      'cluster:alpha|limit=2',
      { preserveState: true }
    );
    expect(hoisted.fetchScopedDomain).toHaveBeenCalledWith('catalog', 'cluster:alpha|limit=2', {
      coalesce: true,
      isManual: true,
      streamSignal: false,
      correlationId: 'broker-read-1',
    });
    expect(hoisted.getScopedDomainState).toHaveBeenCalledWith('catalog', 'cluster:alpha|limit=2');
    expect(hoisted.releaseScopedDomainLease).toHaveBeenCalledWith(
      'catalog',
      'cluster:alpha|limit=2',
      { preserveState: true }
    );
    expect(hoisted.acquireScopedDomainLease.mock.invocationCallOrder[0]).toBeLessThan(
      hoisted.fetchScopedDomain.mock.invocationCallOrder[0]
    );
    expect(hoisted.fetchScopedDomain.mock.invocationCallOrder[0]).toBeLessThan(
      hoisted.getScopedDomainState.mock.invocationCallOrder[0]
    );
    expect(hoisted.getScopedDomainState.mock.invocationCallOrder[0]).toBeLessThan(
      hoisted.releaseScopedDomainLease.mock.invocationCallOrder[0]
    );
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
    expect(read).toHaveBeenCalledWith('broker-read-1');
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

  it('never creates a manual job for an automatic context refresh intent', async () => {
    await expect(
      requestContextRefresh({
        reason: 'startup',
      } as unknown as Parameters<typeof requestContextRefresh>[0])
    ).resolves.toEqual({
      status: 'executed',
      blockedReason: undefined,
    });

    expect(hoisted.triggerManualRefreshForContext).not.toHaveBeenCalled();
  });
  it.each(['throw', 'reject'] as const)(
    'settles failed reads before rethrowing the original %s',
    async (failure) => {
      resetBrokerReadDiagnosticsForTesting();
      const error = new Error('read failed');
      const read = vi.fn(() => {
        expect(getBrokerReadDiagnosticsSnapshot()[0].inFlightCount).toBe(1);
        if (failure === 'throw') {
          throw error;
        }
        return Promise.reject(error);
      });
      await expect(requestData({ resource: 'pods', reason: 'user', read })).rejects.toBe(error);
      expect(getBrokerReadDiagnosticsSnapshot()).toEqual([
        expect.objectContaining({
          inFlightCount: 0,
          errorCount: 1,
          successCount: 0,
          lastStatus: 'error',
        }),
      ]);
    }
  );
});
