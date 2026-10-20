/**
 * frontend/src/core/data-access/dataAccess.ts
 *
 * Centralizes brokered frontend reads and refresh-domain commands so callers
 * get consistent diagnostics, loading accounting, and orchestrator access.
 */

import { recordBlockedBrokerRead, runBrokerRead } from '@/core/read-diagnostics';
import { refreshOrchestrator } from '@/core/refresh';
import { runsWhilePaused } from '@/core/refresh/refreshIntent';
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

export const isDataAccessBlocked = (
  reason: DataRequestReason,
  autoRefreshEnabled: boolean = getAutoRefreshEnabled()
): boolean => {
  return !autoRefreshEnabled && !runsWhilePaused(reason);
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

  const data = await runBrokerRead(
    { broker: 'data-access', resource, adapter, reason, label, scope },
    read
  );
  return { status: 'executed', data };
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
        intent: reason,
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
  preserveState = false,
}: RefreshDomainStateRequest<K>): Promise<RefreshDomainStateResult<K>> => {
  // The read holds its own lease through completion, so it never disables a
  // scope another consumer leases.
  acquireRefreshDomainLease({ domain, scope, preserveState });

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
      data: getScopedDomainState(domain, scope),
    };
  } finally {
    releaseRefreshDomainLease({ domain, scope, preserveState });
  }
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
// mounted consumer holds it, so a remounting or concurrent owner is never torn
// down by an old owner's cleanup. Leases are the only way to enable a scope.
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

// Clears a scope's retained state; while another holder still leases the
// scope, the reset waits for its last release.
export const resetRefreshDomain = (domain: RefreshDomain, scope: string): void => {
  refreshOrchestrator.resetScopedDomain(domain, scope);
};

// Manual refresh of what the named cluster shows: every scope it leases.
export const requestContextRefresh = async ({
  reason,
  clusterId,
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
      // Only an explicit user request refreshes; nothing else is manual.
      if (reason === 'user') {
        await refreshOrchestrator.refreshCluster(clusterId);
      }
    },
  });

  return {
    status: result.status,
    blockedReason: result.blockedReason,
  };
};
