/**
 * frontend/src/ui/layout/DebugOverlay.tsx
 *
 * Shared sidebar-hosted debug overlay shell.
 * Portals into the `.sidebar-overlay-slot` element and provides a consistent
 * title/body layout for debug tooling content.
 */

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from '@shared/components/icons/MenuIcons';

interface DebugOverlayProps {
  title: string;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  testId?: string;
  // Optional header action used to hide the active debug overlay.
  onClose?: () => void;
}

export const DebugOverlay: React.FC<DebugOverlayProps> = ({
  title,
  children,
  className,
  bodyClassName,
  testId,
  onClose,
}) => {
  const [sidebarElement, setSidebarElement] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const existing = document.querySelector('.sidebar-overlay-slot');
    if (existing instanceof HTMLElement) {
      setSidebarElement(existing);
      return;
    }

    const observer = new MutationObserver(() => {
      const sidebar = document.querySelector('.sidebar-overlay-slot');
      if (sidebar instanceof HTMLElement) {
        setSidebarElement(sidebar);
        observer.disconnect();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!sidebarElement) {
    return null;
  }

  const overlayClassName = className ? `debug-overlay ${className}` : 'debug-overlay';
  const resolvedBodyClassName = bodyClassName
    ? `debug-overlay__body ${bodyClassName}`
    : 'debug-overlay__body';

  return createPortal(
    <div className={overlayClassName} data-testid={testId}>
      <div className="debug-overlay__header">
        <span className="debug-overlay__title">{title}</span>
        {onClose ? (
          <button
            type="button"
            className="debug-overlay__close"
            onClick={onClose}
            aria-label="Close debug overlay"
            title="Close"
          >
            <CloseIcon width={14} height={14} />
          </button>
        ) : null}
      </div>
      <div className={resolvedBodyClassName}>{children}</div>
    </div>,
    sidebarElement
  );
};
