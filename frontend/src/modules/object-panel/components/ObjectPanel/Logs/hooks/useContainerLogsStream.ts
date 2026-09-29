/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/useContainerLogsStream.ts
 *
 * Runs the container-logs stream for a Logs tab only while it should be live:
 * the tab is active, auto-refresh is on and previous logs are not shown.
 *
 * Enabling the scoped domain starts streaming; calling startStreamingDomain as
 * well races the orchestrator's deduplication under React Strict Mode.
 */

import { useEffect } from 'react';
import { setRefreshDomainEnabled } from '@/core/data-access';
import { refreshOrchestrator } from '@/core/refresh/orchestrator';

const CONTAINER_LOGS_DOMAIN = 'container-logs' as const;

// preserveState keeps the buffered entries while the stream is off (so the
// view freezes instead of emptying) and when it is enabled again after a
// remount such as a cluster switch.
const setStreamEnabled = (scope: string, enabled: boolean): void => {
  setRefreshDomainEnabled({ domain: CONTAINER_LOGS_DOMAIN, scope, enabled, preserveState: true });
};

const stopStream = (scope: string): void => {
  refreshOrchestrator.stopStreamingDomain(CONTAINER_LOGS_DOMAIN, scope, { reset: false });
  setStreamEnabled(scope, false);
};

export function useContainerLogsStream({
  scope,
  isActive,
  autoRefresh,
  showPreviousContainerLogs,
}: {
  scope: string | null;
  isActive: boolean;
  autoRefresh: boolean;
  showPreviousContainerLogs: boolean;
}): void {
  const live = isActive && autoRefresh && !showPreviousContainerLogs;
  useEffect(() => {
    if (!scope) {
      return;
    }
    if (!live) {
      stopStream(scope);
      return;
    }
    setStreamEnabled(scope, true);
    return () => stopStream(scope);
  }, [live, scope]);
}
