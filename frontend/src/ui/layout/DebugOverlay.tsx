/**
 * frontend/src/ui/layout/DebugOverlay.tsx
 *
 * Shared sidebar-hosted debug overlay shell.
 * Portals into the `.sidebar` element and provides a consistent
 * title/body layout for debug tooling content.
 */

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface DebugOverlayProps {
  title: string;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  testId?: string;
}

export const DebugOverlay: React.FC<DebugOverlayProps> = ({
  title,
  children,
  className,
  bodyClassName,
  testId,
}) => {
  const [sidebarElement, setSidebarElement] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const existing = document.querySelector('.sidebar');
    if (existing instanceof HTMLElement) {
      setSidebarElement(existing);
      return;
    }

    const observer = new MutationObserver(() => {
      const sidebar = document.querySelector('.sidebar');
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
      <div className="debug-overlay__header">{title}</div>
      <div className={resolvedBodyClassName}>{children}</div>
    </div>,
    sidebarElement
  );
};

