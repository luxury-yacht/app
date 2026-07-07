/**
 * frontend/src/shared/components/ObjectPanelLink.tsx
 *
 * Reusable link component for opening Kubernetes objects in the object panel.
 * - Click → opens the object in a new Object Panel tab (existing behavior)
 * - Alt+click → navigates to the object's view and focuses it in the grid table
 * - Keyboard: Enter/Space with alt key variant
 */

import React, { useCallback } from 'react';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import type { KubernetesObjectReference } from '@/types/view-state';

export interface ObjectPanelLinkProps {
  objectRef: KubernetesObjectReference;
  /**
   * Optional alt-click / navigate target, when it should differ from the
   * opened object. The namespace field in object-panel details uses this: a
   * plain click opens the Namespace object, but alt-click should reveal the
   * HOST object (the one whose panel is open) in its list — which also selects
   * the namespace in the sidebar. Falls back to objectRef when omitted.
   */
  navigateRef?: KubernetesObjectReference;
  children: React.ReactNode;
  title?: string;
  className?: string;
}

export const ObjectPanelLink: React.FC<ObjectPanelLinkProps> = ({
  objectRef,
  navigateRef,
  children,
  title,
  className,
}) => {
  const { openWithObject } = useObjectPanel();
  const { navigateToView } = useNavigateToView();
  const navigateTarget = navigateRef ?? objectRef;

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      if (event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        navigateToView(navigateTarget);
      } else {
        openWithObject(objectRef);
      }
    },
    [objectRef, navigateTarget, openWithObject, navigateToView]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (event.altKey) {
          navigateToView(navigateTarget);
        } else {
          openWithObject(objectRef);
        }
      }
    },
    [objectRef, navigateTarget, openWithObject, navigateToView]
  );

  const combinedClassName = ['object-panel-link', className].filter(Boolean).join(' ');

  return (
    <span
      className={combinedClassName}
      role="button"
      tabIndex={0}
      title={title}
      data-gridtable-shortcut-optout="true"
      data-gridtable-rowclick="allow"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {children}
    </span>
  );
};
