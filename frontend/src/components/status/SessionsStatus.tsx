/**
 * frontend/src/components/status/SessionsStatus.tsx
 *
 * Unified header status indicator for shell sessions and port forwards.
 */

import React, { useCallback, useMemo } from 'react';
import StatusIndicator, { type StatusState } from './StatusIndicator';
import { usePortForwardStatus } from '@modules/port-forward/hooks/usePortForwardStatus';
import { useShellSessionStatus } from '@modules/shell-session/hooks/useShellSessionStatus';
import { useActiveSessionsPanel } from '@modules/active-session';

const SessionsStatus: React.FC = () => {
  const shell = useShellSessionStatus();
  const portForwards = usePortForwardStatus();
  const activeSessionsPanel = useActiveSessionsPanel();

  const totalCount = shell.totalCount + portForwards.totalCount;
  const totalHealthy = shell.totalCount + portForwards.healthyCount;
  const totalUnhealthy = portForwards.unhealthyCount;

  const status = useMemo<StatusState>(() => {
    if (totalCount === 0) return 'inactive';
    if (totalUnhealthy === 0) return 'healthy';
    if (totalHealthy === 0) return 'unhealthy';
    return 'degraded';
  }, [totalCount, totalHealthy, totalUnhealthy]);

  const message = useMemo(
    () => (
      <>
        <div>Shell Sessions: {shell.totalCount}</div>
        <div>Port Forwards: {portForwards.totalCount}</div>
      </>
    ),
    [portForwards.totalCount, shell.totalCount]
  );

  const messageAria = useMemo(
    () => `Shell Sessions: ${shell.totalCount}. Port Forwards: ${portForwards.totalCount}.`,
    [portForwards.totalCount, shell.totalCount]
  );

  const handleAction = useCallback(() => {
    activeSessionsPanel.setOpen(true);
  }, [activeSessionsPanel]);

  return (
    <StatusIndicator
      status={status}
      title="Sessions"
      message={message}
      actionLabel={totalCount > 0 ? 'Manage' : undefined}
      onAction={totalCount > 0 ? handleAction : undefined}
      ariaLabel={`Sessions: ${messageAria}`}
    />
  );
};

export default React.memo(SessionsStatus);
