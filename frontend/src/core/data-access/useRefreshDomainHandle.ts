/**
 * frontend/src/core/data-access/useRefreshDomainHandle.ts
 *
 * React hook that bundles scoped refresh-domain state, lifecycle enablement,
 * manual refresh, reset, and latest-state reads behind one typed handle.
 */

import { useCallback } from 'react';

import { useRefreshScopedDomain } from '@/core/refresh';
import type { RefreshDomain } from '@/core/refresh/types';
import {
  readRefreshDomainState,
  requestRefreshDomain,
  resetRefreshDomain,
  setRefreshDomainEnabled,
} from './dataAccess';
import type { DataRequestReason } from './types';
import { useScopedRefreshDomainLifecycle } from './useScopedRefreshDomainLifecycle';

interface UseRefreshDomainHandleOptions<K extends RefreshDomain> {
  domain: K | null | undefined;
  scope: string | null | undefined;
  enabled: boolean;
  preserveState?: boolean;
}

export function useRefreshDomainHandle<K extends RefreshDomain = RefreshDomain>({
  domain,
  scope,
  enabled,
  preserveState = false,
}: UseRefreshDomainHandleOptions<K>) {
  const readDomain = (domain ?? 'namespaces') as K;
  const readScope = scope ?? '';
  const state = useRefreshScopedDomain(readDomain, readScope);

  useScopedRefreshDomainLifecycle({
    domain,
    scope,
    enabled,
    preserveState,
  });

  const setEnabled = useCallback(
    (nextEnabled: boolean, nextScope = scope ?? '') => {
      if (!domain || !nextScope) {
        return;
      }
      setRefreshDomainEnabled({
        domain,
        scope: nextScope,
        enabled: nextEnabled,
        preserveState,
      });
    },
    [domain, preserveState, scope]
  );

  const refresh = useCallback(
    async (reason: DataRequestReason = 'user', nextScope = scope ?? '') => {
      if (!domain || !nextScope) {
        return { status: 'blocked' as const, blockedReason: 'auto-refresh-disabled' as const };
      }
      return requestRefreshDomain({ domain, scope: nextScope, reason });
    },
    [domain, scope]
  );

  const reset = useCallback(
    (nextScope = scope ?? '') => {
      if (!domain || !nextScope) {
        return;
      }
      resetRefreshDomain(domain, nextScope);
    },
    [domain, scope]
  );

  const readLatest = useCallback(
    (nextScope = scope ?? '') => {
      if (!domain || !nextScope) {
        return null;
      }
      return readRefreshDomainState(domain, nextScope);
    },
    [domain, scope]
  );

  return {
    state,
    data: state.data,
    setEnabled,
    refresh,
    reset,
    readLatest,
  };
}
