/**
 * frontend/src/components/status/StatusIndicator.tsx
 *
 * Shared status indicator component.
 * Renders a colored dot with a hover tooltip that appears below.
 * Header indicators (Connectivity, Metrics, Sessions) use this.
 */

import React from 'react';
import Tooltip from '@shared/components/Tooltip';
import './StatusIndicator.css';

/** The five shared status states. */
export type StatusState = 'healthy' | 'refreshing' | 'degraded' | 'unhealthy' | 'inactive';

export interface StatusIndicatorProps {
  /** Current status state — drives the dot color and animation. */
  status: StatusState;
  /** Popover title (e.g., "Connectivity"). */
  title: string;
  /** Popover status message (e.g., "Connected"). */
  message: React.ReactNode;
  /** Optional action button label (e.g., "Refresh"). Omit to hide the button. */
  actionLabel?: string;
  /** Called when the action button is clicked. */
  onAction?: () => void;
  /** Accessible label for screen readers. */
  ariaLabel: string;
  /** Optional extra class name applied to the tooltip popover element. */
  tooltipClassName?: string;
  /** Hide the tooltip title row for indicators with self-describing content. */
  hideTitle?: boolean;
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  status,
  title,
  message,
  actionLabel,
  onAction,
  ariaLabel,
  tooltipClassName,
  hideTitle,
}) => {
  /* Build the rich tooltip content matching the existing popover layout */
  const tooltipContent = (
    <div className="status-popover-content" data-status={status}>
      {!hideTitle && <div className="status-popover-title">{title}</div>}
      <div className="status-popover-message">{message}</div>
      {actionLabel && onAction && (
        <div className="status-popover-action">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAction();
            }}
          >
            {actionLabel}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <Tooltip
      content={tooltipContent}
      placement="bottom"
      showArrow={false}
      hoverDelay={150}
      className={tooltipClassName ? `status-popover ${tooltipClassName}` : 'status-popover'}
      interactive
    >
      <div className="status-indicator" aria-label={ariaLabel} role="status" tabIndex={0}>
        <div className="status-indicator-dot" data-status={status} />
      </div>
    </Tooltip>
  );
};

export default React.memo(StatusIndicator);
