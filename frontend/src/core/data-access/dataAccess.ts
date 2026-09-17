/**
 * frontend/src/core/data-access/dataAccess.ts
 *
 * Centralizes brokered frontend reads and refresh-domain commands so callers
 * get consistent diagnostics, loading accounting, and orchestrator access.
 */

import {
  beginBrokerRead,
  completeBrokerRead,
  recordBlockedBrokerRead,
} from '@/core/read-diagnostics';
import { refreshOrchestrator } from '@/core/refresh';
import type { RefreshDemand } from '@/core/refresh/refreshRuntime';
import { getScopedDomainState } from '@/core/refresh/store';
import type { RefreshDomain } from '@/core/refresh/types';
import { getAutoRefreshEnabled } from '@/core/settings/appPreferences';
import type {
  ContextRefreshRequest,
  DataReadRequest,
  DataReadResult,
  DataRequestReason,
  DataRequestResult,
  RefreshDomainRequest,
  RefreshDomainStateRequest,
  RefreshDomainStateResult,
} from './types';

const isReasonAllowedWhilePaused = (reason: DataRequestReason): boolean => {
  return reason === 'foreground' || reason === 'user';
};

export const isDataAccessBlocked = (
  reason: DataRequestReason,
  autoRefreshEnabled: boolean = getAutoRefreshEnabled()
): boolean => {
  return !autoRefreshEnabled && !isReasonAllowedWhilePaused(reason);
};

export const requestData = async <T>({
  resource,
  reason,
  adapter = 'rpc-read',
  label,
  scope,
  read,
}: DataReadRequest<T>): Promise<DataReadResult<T>> => {
  if (isDataAccessBlocked(reason)) {
    recordBlockedBrokerRead(
      {
        broker: 'data-access',
        resource,
        adapter,
        reason,
        label,
        scope,
      },
      'auto-refresh-disabled'
    );
    return {
      status: 'blocked',
      blockedReason: 'auto-refresh-disabled',
    };
  }

  const token = beginBrokerRead({
    broker: 'data-access',
    resource,
    adapter,
    reason,
    label,
    scope,
  });

  try {
    const data = await read(token);
    completeBrokerRead({ token, status: 'success' });
    return {
      status: 'executed',
      data,
    };
  } catch (error) {
    completeBrokerRead({ token, status: 'error', error });
    throw error;
  }
};

const performRefreshDomainRequest = async (
  { domain, scope, reason, label }: RefreshDomainRequest,
  coalesce = false
): Promise<DataRequestResult> => {
  const result = await requestData<void>({
    resource: domain,
    reason,
    adapter: 'refresh-domain',
    label: label ?? domain,
    scope,
    read: async (requestId) => {
      await refreshOrchestrator.fetchScopedDomain(domain, scope, {
        ...(coalesce ? { coalesce: true } : {}),
        isManual: reason === 'user',
        streamSignal: reason === 'stream-signal',
        ...(requestId ? { correlationId: requestId } : {}),
      });
    },
  });

  return {
    status: result.status,
    blockedReason: result.blockedReason,
  };
};

export const requestRefreshDomain = (request: RefreshDomainRequest): Promise<DataRequestResult> =>
  performRefreshDomainRequest(request);

export const requestRefreshDomainState = async <K extends RefreshDomain>({
  domain,
  scope,
  reason,
  label,
  cleanup = true,
  preserveState = false,
}: RefreshDomainStateRequest<K>): Promise<RefreshDomainStateResult<K>> => {
  if (cleanup) {
    acquireRefreshDomainLease({ domain, scope, preserveState });
  } else {
    setRefreshDomainEnabled({ domain, scope, enabled: true, preserveState });
  }

  try {
    const result = await performRefreshDomainRequest({ domain, scope, reason, label }, true);
    if (result.status !== 'executed') {
      return {
        status: result.status,
        blockedReason: result.blockedReason,
      };
    }

    return {
      status: 'executed',
      data: readRefreshDomainState(domain, scope),
    };
  } finally {
    if (cleanup) {
      releaseRefreshDomainLease({ domain, scope, preserveState });
    }
  }
};

export const setRefreshDomainEnabled = ({
  domain,
  scope,
  enabled,
  preserveState = false,
}: {
  domain: RefreshDomain;
  scope: string;
  enabled: boolean;
  preserveState?: boolean;
}): void => {
  if (preserveState) {
    refreshOrchestrator.setScopedDomainEnabled(domain, scope, enabled, { preserveState });
    return;
  }
  refreshOrchestrator.setScopedDomainEnabled(domain, scope, enabled);
};

interface RefreshDomainLease {
  domain: RefreshDomain;
  scope: string;
  preserveState?: boolean;
  demand?: RefreshDemand;
}

const refreshDomainLeaseOptions = ({
  preserveState = false,
  demand = 'snapshot',
}: RefreshDomainLease): { preserveState: boolean; demand?: RefreshDemand } | undefined => {
  if (demand !== 'snapshot') {
    return { preserveState, demand };
  }
  return preserveState ? { preserveState } : undefined;
};

// Reference-counted lease that keeps a scoped refresh domain enabled while any
// mounted consumer holds it. Use this instead of setRefreshDomainEnabled for
// component lifecycles so a remounting/concurrent owner is not torn down by an
// old owner's cleanup.
export const acquireRefreshDomainLease = (lease: RefreshDomainLease): void => {
  refreshOrchestrator.acquireScopedDomainLease(
    lease.domain,
    lease.scope,
    refreshDomainLeaseOptions(lease)
  );
};

export const releaseRefreshDomainLease = (lease: RefreshDomainLease): void => {
  refreshOrchestrator.releaseScopedDomainLease(
    lease.domain,
    lease.scope,
    refreshDomainLeaseOptions(lease)
  );
};

export const resetRefreshDomain = (domain: RefreshDomain, scope: string): void => {
  refreshOrchestrator.resetScopedDomain(domain, scope);
};

export const readRefreshDomainState = <K extends RefreshDomain>(domain: K, scope: string) =>
  getScopedDomainState(domain, scope);

export const requestContextRefresh = async ({
  reason,
  context,
  resource = 'refresh-context',
  label,
  scope,
}: ContextRefreshRequest): Promise<DataRequestResult> => {
  const result = await requestData<void>({
    resource,
    reason,
    adapter: 'context-refresh',
    label: label ?? 'refresh-context',
    scope,
    read: async () => {
      if (reason === 'user') {
        await refreshOrchestrator.triggerManualRefreshForContext(context);
      }
    },
  });

  return {
    status: result.status,
    blockedReason: result.blockedReason,
  };
};
