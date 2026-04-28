/**
 * frontend/src/shared/components/StatusChip.tsx
 *
 * Compact pill badge for surface-level status indicators (e.g., Kubernetes
 * resource conditions, health states, advisory tags).
 *
 * Renders as a tinted-background, same-hue-text chip. When a tooltip is
 * provided, the chip is wrapped in the shared Tooltip component so the
 * fuller message is available on hover.
 */

import React from 'react';
import Tooltip from '@shared/components/Tooltip';
import './StatusChip.css';

export type StatusChipVariant = 'healthy' | 'unhealthy' | 'warning' | 'info';

export interface StatusChipProps {
  /** Visual treatment — picks the bg/text/border color triplet. */
  variant: StatusChipVariant;
  /** Chip label (kept short — typically a single word or two). */
  children: React.ReactNode;
  /** Optional tooltip content shown on hover. When absent, no tooltip wraps the chip. */
  tooltip?: React.ReactNode;
  /** Optional extra class for callers that need to tweak layout in context. */
  className?: string;
}

export const StatusChip: React.FC<StatusChipProps> = ({
  variant,
  children,
  tooltip,
  className,
}) => {
  const chipClassName = ['status-chip', `status-chip--${variant}`, className]
    .filter(Boolean)
    .join(' ');
  const chip = <span className={chipClassName}>{children}</span>;
  if (!tooltip) {
    return chip;
  }
  return (
    <Tooltip content={tooltip} className="status-chip-tooltip">
      {chip}
    </Tooltip>
  );
};
