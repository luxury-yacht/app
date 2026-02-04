/**
 * frontend/src/components/status/PortForwardStatus.tsx
 *
 * Port forward status indicator for the app header.
 * Always visible. Gray when no forwards exist, color-coded otherwise.
 * Click action: open the port forwards panel.
 */

import React, { useCallback } from 'react';
import StatusIndicator from './StatusIndicator';
import { usePortForwardStatus } from '@modules/port-forward/hooks/usePortForwardStatus';
import { usePortForwardsPanel } from '@modules/port-forward/PortForwardsPanel';

const PortForwardStatus: React.FC = () => {
  const { status, totalCount, healthyCount, unhealthyCount } = usePortForwardStatus();
  const panel = usePortForwardsPanel();

  /** Generate the popover message. */
  const getMessage = (): string => {
    if (totalCount === 0) return 'No port forwards';
    if (unhealthyCount === 0) {
      return `${totalCount} port forward${totalCount === 1 ? '' : 's'} active`;
    }
    if (healthyCount === 0) {
      return `All ${totalCount} port forward${totalCount === 1 ? '' : 's'} unhealthy`;
    }
    return `${unhealthyCount} of ${totalCount} port forward${totalCount === 1 ? '' : 's'} unhealthy`;
  };

  const handleAction = useCallback(() => {
    panel.setOpen(true);
  }, [panel]);

  const message = getMessage();

  return (
    <StatusIndicator
      status={status}
      title="Port Forwards"
      message={message}
      actionLabel={totalCount > 0 ? 'Manage' : undefined}
      onAction={totalCount > 0 ? handleAction : undefined}
      ariaLabel={`Port Forwards: ${message}`}
    />
  );
};

export default React.memo(PortForwardStatus);
