/**
 * frontend/src/core/data-access/useRefreshDomainHandle.ts
 *
 * React hook that bundles scoped refresh-domain state, its lease, and manual
 * refresh behind one typed handle.
 */

import { useCallback } from 'react';

import { useRefreshScopedDomain } from '@/core/refresh';
import type { RefreshDemand } from '@/core/refresh/refreshRuntime';
import type { RefreshDomain } from '@/core/refresh/types';
import { requestRefreshDomain } from './dataAccess';
import type { DataRequestReason } from './types';
import { useScopedRefreshDomainLifecycle } from './useScopedRefreshDomainLifecycle';

interface UseRefreshDomainHandleOptions<K extends RefreshDomain> {
  domain: K | null | undefined;
  scope: string | null | undefined;
  enabled: boolean;
  preserveState?: boolean;
  demand?: RefreshDemand;
  fetchOnEnable?: DataRequestReason | false;
  onFetchError?: (error: unknown) => void;
}

export function useRefreshDomainHandle<K extends RefreshDomain = RefreshDomain>({
  domain,
  scope,
  enabled,
  preserveState = false,
  demand = 'snapshot',
  fetchOnEnable = false,
  onFetchError,
}: UseRefreshDomainHandleOptions<K>) {
  const readDomain = (domain ?? 'namespaces') as K;
  const readScope = scope ?? '';
  const state = useRefreshScopedDomain(readDomain, readScope);

  useScopedRefreshDomainLifecycle({
    domain,
    scope,
    enabled,
    preserveState,
    demand,
    fetchOnEnable,
    onFetchError,
  });

  const refresh = useCallback(
    async (reason: DataRequestReason = 'user', nextScope = scope ?? '') => {
      if (!domain || !nextScope) {
        return { status: 'blocked' as const, blockedReason: 'auto-refresh-disabled' as const };
      }
      return requestRefreshDomain({ domain, scope: nextScope, reason });
    },
    [domain, scope]
  );

  return {
    state,
    data: state.data,
    refresh,
  };
}
