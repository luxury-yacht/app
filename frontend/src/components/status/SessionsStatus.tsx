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

const pluralize = (count: number, singular: string, plural: string): string =>
  `${count} ${count === 1 ? singular : plural}`;

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

  const message = useMemo(() => {
    if (totalCount === 0) {
      return 'No active sessions';
    }

    if (shell.totalCount === 0) {
      if (portForwards.unhealthyCount === 0) {
        return `${pluralize(portForwards.totalCount, 'port forward', 'port forwards')} active`;
      }
      if (portForwards.healthyCount === 0) {
        return `All ${pluralize(portForwards.totalCount, 'port forward', 'port forwards')} unhealthy`;
      }
      return `${portForwards.unhealthyCount} of ${pluralize(portForwards.totalCount, 'port forward', 'port forwards')} unhealthy`;
    }

    if (portForwards.totalCount === 0) {
      return `${pluralize(shell.totalCount, 'shell session', 'shell sessions')} active`;
    }

    const details = [
      pluralize(shell.totalCount, 'shell session', 'shell sessions'),
      pluralize(portForwards.totalCount, 'port forward', 'port forwards'),
    ];
    if (portForwards.unhealthyCount > 0) {
      details.push(`${pluralize(portForwards.unhealthyCount, 'unhealthy port forward', 'unhealthy port forwards')}`);
    }
    return `${pluralize(totalCount, 'session', 'sessions')} active (${details.join(', ')})`;
  }, [
    portForwards.healthyCount,
    portForwards.totalCount,
    portForwards.unhealthyCount,
    shell.totalCount,
    totalCount,
  ]);

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
      ariaLabel={`Sessions: ${message}`}
    />
  );
};

export default React.memo(SessionsStatus);
