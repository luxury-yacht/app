import { refreshOrchestrator } from '@/core/refresh';
import { getAutoRefreshEnabled } from '@/core/settings/appPreferences';
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
} from './types';

export const isReasonAllowedWhilePaused = (reason: DataRequestReason): boolean => {
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
  read,
}: DataReadRequest<T>): Promise<DataReadResult<T>> => {
  if (isDataAccessBlocked(reason)) {
    recordBlockedBrokerRead(
      {
        broker: 'data-access',
        resource,
        adapter,
        reason,
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
}: RefreshDomainRequest): Promise<DataRequestResult> => {
  const result = await requestData<void>({
    resource: domain,
    reason,
    adapter: 'refresh-domain',
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

export const requestContextRefresh = async ({
  reason,
  context,
}: ContextRefreshRequest): Promise<DataRequestResult> => {
  const result = await requestData<void>({
    resource: 'refresh-context',
    reason,
    adapter: 'context-refresh',
    read: async () => {
      await refreshOrchestrator.triggerManualRefreshForContext(context);
    },
  });

  return {
    status: result.status,
    blockedReason: result.blockedReason,
  };
};
