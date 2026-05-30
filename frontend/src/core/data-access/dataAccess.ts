/**
 * frontend/src/core/data-access/dataAccess.ts
 *
 * Centralizes brokered frontend reads and refresh-domain commands so callers
 * get consistent diagnostics, loading accounting, and orchestrator access.
 */

import { refreshOrchestrator } from '@/core/refresh';
import { getAutoRefreshEnabled } from '@/core/settings/appPreferences';
import { getScopedDomainState } from '@/core/refresh/store';
import {
  beginBrokerRead,
  completeBrokerRead,
  recordBlockedBrokerRead,
} from '@/core/read-diagnostics';

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
import type { RefreshDomain } from '@/core/refresh/types';

const isReasonAllowedWhilePaused = (reason: DataRequestReason): boolean => {
  return reason === 'user';
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
    const data = await read();
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

export const requestRefreshDomain = async ({
  domain,
  scope,
  reason,
  label,
}: RefreshDomainRequest): Promise<DataRequestResult> => {
  const result = await requestData<void>({
    resource: domain,
    reason,
    adapter: 'refresh-domain',
    label: label ?? domain,
    scope,
    read: async () => {
      await refreshOrchestrator.fetchScopedDomain(domain, scope, {
        isManual: reason === 'user',
      });
    },
  });

  return {
    status: result.status,
    blockedReason: result.blockedReason,
  };
};

export const requestRefreshDomainState = async <K extends RefreshDomain>({
  domain,
  scope,
  reason,
  label,
  cleanup = true,
  preserveState = false,
}: RefreshDomainStateRequest<K>): Promise<RefreshDomainStateResult<K>> => {
  setRefreshDomainEnabled({ domain, scope, enabled: true, preserveState });

  try {
    const result = await requestRefreshDomain({ domain, scope, reason, label });
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
      setRefreshDomainEnabled({ domain, scope, enabled: false, preserveState });
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
      await refreshOrchestrator.triggerManualRefreshForContext(context);
    },
  });

  return {
    status: result.status,
    blockedReason: result.blockedReason,
  };
};
