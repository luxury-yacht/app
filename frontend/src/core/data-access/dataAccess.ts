import { refreshOrchestrator } from '@/core/refresh';
import { getAutoRefreshEnabled } from '@/core/settings/appPreferences';

import type { DataRequestReason, DataRequestResult, RefreshDomainRequest } from './types';

export const isReasonAllowedWhilePaused = (reason: DataRequestReason): boolean => {
  return reason === 'user';
};

export const isDataAccessBlocked = (
  reason: DataRequestReason,
  autoRefreshEnabled: boolean = getAutoRefreshEnabled()
): boolean => {
  return !autoRefreshEnabled && !isReasonAllowedWhilePaused(reason);
};

export const requestRefreshDomain = async ({
  domain,
  scope,
  reason,
}: RefreshDomainRequest): Promise<DataRequestResult> => {
  if (isDataAccessBlocked(reason)) {
    return {
      status: 'blocked',
      blockedReason: 'auto-refresh-disabled',
    };
  }

  await refreshOrchestrator.fetchScopedDomain(domain, scope, {
    isManual: reason === 'user',
  });

  return {
    status: 'executed',
  };
};
