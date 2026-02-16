/**
 * frontend/src/components/status/ShellSessionStatus.tsx
 *
 * Header status indicator for shell sessions.
 */

import React, { useCallback } from 'react';
import StatusIndicator from './StatusIndicator';
import { useShellSessionStatus } from '@modules/shell-session/hooks/useShellSessionStatus';
import { useShellSessionsPanel } from '@modules/shell-session';

const ShellSessionStatus: React.FC = () => {
  const { status, totalCount } = useShellSessionStatus();
  const panel = useShellSessionsPanel();

  const message =
    totalCount === 0
      ? 'No shell sessions'
      : `${totalCount} shell session${totalCount === 1 ? '' : 's'} active`;

  const handleAction = useCallback(() => {
    panel.setOpen(true);
  }, [panel]);

  return (
    <StatusIndicator
      status={status}
      title="Shell Sessions"
      message={message}
      actionLabel={totalCount > 0 ? 'Manage' : undefined}
      onAction={totalCount > 0 ? handleAction : undefined}
      ariaLabel={`Shell Sessions: ${message}`}
    />
  );
};

export default React.memo(ShellSessionStatus);
