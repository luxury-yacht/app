/**
 * frontend/src/components/status/StatusIndicator.tsx
 *
 * Shared status indicator component.
 * Renders a colored dot with an optional popover that appears below.
 * All three header indicators (Connectivity, Metrics, Port Forwards) use this.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import './StatusIndicator.css';

/** The five shared status states. */
export type StatusState = 'healthy' | 'refreshing' | 'degraded' | 'unhealthy' | 'inactive';

export interface StatusIndicatorProps {
  /** Current status state — drives the dot color and animation. */
  status: StatusState;
  /** Popover title (e.g., "Connectivity"). */
  title: string;
  /** Popover status message (e.g., "Connected"). */
  message: string;
  /** Optional action button label (e.g., "Refresh"). Omit to hide the button. */
  actionLabel?: string;
  /** Called when the action button is clicked. */
  onAction?: () => void;
  /** Accessible label for screen readers. */
  ariaLabel: string;
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  status,
  title,
  message,
  actionLabel,
  onAction,
  ariaLabel,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  /** Close the popover when clicking outside or pressing Escape. */
  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (ref.current && !ref.current.contains(e.target as Node)) {
      setIsOpen(false);
    }
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleClickOutside, handleKeyDown]);

  return (
    <div
      className="status-indicator"
      ref={ref}
      onClick={() => setIsOpen((prev) => !prev)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setIsOpen((prev) => !prev);
        }
      }}
      aria-label={ariaLabel}
      role="button"
      tabIndex={0}
    >
      <div className="status-indicator-dot" data-status={status} />
      {isOpen && (
        <div className="status-popover">
          <div className="status-popover-title">{title}</div>
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
      )}
    </div>
  );
};

export default React.memo(StatusIndicator);
