/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/useContainerLogsStream.ts
 *
 * Runs the container-logs stream for a Logs tab only while it should be live:
 * the tab is active, auto-refresh is on and previous logs are not shown.
 *
 * The lease starts the stream; its release stops it. Calling the stream
 * commands as well races the orchestrator's deduplication under React Strict
 * Mode.
 */

import { useScopedRefreshDomainLifecycle } from '@/core/data-access';

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
  // preserveState keeps the buffered entries while the stream is off (so the
  // view freezes instead of emptying) and when it is enabled again after a
  // remount such as a cluster switch.
  useScopedRefreshDomainLifecycle({
    domain: 'container-logs',
    scope,
    enabled: isActive && autoRefresh && !showPreviousContainerLogs,
    preserveState: true,
  });
}
