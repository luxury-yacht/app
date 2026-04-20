import { refreshOrchestrator } from '@/core/refresh';
import { getAutoRefreshEnabled } from '@/core/settings/appPreferences';

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
  reason,
  read,
}: DataReadRequest<T>): Promise<DataReadResult<T>> => {
  if (isDataAccessBlocked(reason)) {
    return {
      status: 'blocked',
      blockedReason: 'auto-refresh-disabled',
    };
  }

  const data = await read();
  return {
    status: 'executed',
    data,
  };
};

export const requestRefreshDomain = async ({
  domain,
  scope,
  reason,
}: RefreshDomainRequest): Promise<DataRequestResult> => {
  const result = await requestData<void>({
    resource: domain,
    reason,
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
    read: async () => {
      await refreshOrchestrator.triggerManualRefreshForContext(context);
    },
  });

  return {
    status: result.status,
    blockedReason: result.blockedReason,
  };
};
