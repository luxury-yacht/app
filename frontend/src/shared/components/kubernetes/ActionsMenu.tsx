/**
 * frontend/src/shared/components/kubernetes/ActionsMenu.tsx
 *
 * Actions menu for the Object Panel. Renders a dropdown of the available
 * actions for the current object and delegates ALL execution, permission
 * gating, and modal handling to the shared object action controller — the
 * same path grid/map surfaces use. The panel supplies only object-panel
 * lifecycle callbacks (close after delete, refetch after a mutating action)
 * and the Node cordon/drain openers.
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { type ObjectActionData } from '@shared/hooks/useObjectActions';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import '../ContextMenu.css';
import './ActionsMenu.css';

const clampReplicas = (value: number): number => Math.max(0, Math.min(9999, value));

const parseDesiredReplicas = (value?: string | null): number | null => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const segments = trimmed.split('/');
  const candidate = Number.parseInt(segments[segments.length - 1]?.trim() ?? '', 10);
  return Number.isFinite(candidate) ? clampReplicas(candidate) : null;
};

interface ActionsMenuProps {
  object: ObjectActionData | null;
  currentReplicas?: number;
  actionLoading?: boolean;
  // Whether a HorizontalPodAutoscaler manages this workload. Null means unknown.
  hpaManaged?: boolean | null;
  /** Called after a successful delete so the panel can close. */
  onAfterDelete?: () => void;
  /** Called after a successful restart/scale/trigger/suspend so the panel can refetch. */
  onAfterAction?: () => void;
  /** Node-only: open the cordon/drain modals owned by the caller. */
  onCordon?: () => void;
  onDrain?: () => void;
}

export const ActionsMenu = React.memo<ActionsMenuProps>(
  ({
    object,
    currentReplicas,
    actionLoading = false,
    hpaManaged = null,
    onAfterDelete,
    onAfterAction,
    onCordon,
    onDrain,
  }) => {
    const { openWithObject } = useObjectPanel();
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const resolvedCurrentReplicas = useMemo(() => {
      if (typeof currentReplicas === 'number' && Number.isFinite(currentReplicas)) {
        return clampReplicas(currentReplicas);
      }
      return parseDesiredReplicas(object?.ready) ?? 0;
    }, [currentReplicas, object?.ready]);

    // Merge the resolved replica count and HPA-ownership flag into the object
    // the controller reasons about. Unknown HPA ownership must stay unknown so
    // scale actions fail closed.
    const actionObject = useMemo(
      () =>
        object
          ? {
              ...object,
              desiredReplicas: resolvedCurrentReplicas,
              hpaManaged: hpaManaged ?? object.hpaManaged ?? null,
            }
          : null,
      [object, hpaManaged, resolvedCurrentReplicas]
    );

    const objectActions = useObjectActionController({
      context: 'object-panel',
      actionLoading,
      onAfterDelete: onAfterDelete ? () => onAfterDelete() : undefined,
      onAfterAction: onAfterAction ? () => onAfterAction() : undefined,
      onOpenObjectMap: (target) => {
        setIsOpen(false);
        openWithObject(target, { initialTab: 'map' });
      },
      perObjectHandlers: {
        onCordon: onCordon ? () => onCordon() : undefined,
        onDrain: onDrain ? () => onDrain() : undefined,
      },
    });

    // Menu items from the centralized controller (permission-gated; execution +
    // modals owned by the controller).
    const menuItems = useMemo(
      () => objectActions.getMenuItems(actionObject),
      [actionObject, objectActions]
    );

    // Close menu when clicking outside
    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
          setIsOpen(false);
        }
      };

      if (isOpen) {
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
      }
    }, [isOpen]);

    // Position dropdown to stay within viewport
    useEffect(() => {
      if (isOpen && dropdownRef.current && menuRef.current) {
        const dropdown = dropdownRef.current;
        const button = menuRef.current.querySelector('.actions-menu-button');
        if (!button) return;

        const buttonRect = button.getBoundingClientRect();
        const dropdownRect = dropdown.getBoundingClientRect();

        // Check if dropdown would go off-screen to the right
        if (buttonRect.right - dropdownRect.width < 10) {
          dropdown.style.right = 'auto';
          dropdown.style.left = '0';
        }

        // Check if dropdown would go off-screen at the bottom
        if (buttonRect.bottom + dropdownRect.height > window.innerHeight - 10) {
          dropdown.style.top = 'auto';
          dropdown.style.bottom = 'calc(100% + 4px)';
        }
      }
    }, [isOpen]);

    // Don't render if no actions available
    if (menuItems.length === 0) {
      return null;
    }

    return (
      <>
        <div className="actions-menu" ref={menuRef}>
          <button
            className="actions-menu-button"
            onClick={() => setIsOpen(!isOpen)}
            disabled={actionLoading}
            title="Actions"
            aria-label="Actions menu"
          >
            <span className="actions-menu-icon">⋯</span>
          </button>

          {isOpen && (
            <div className="context-menu actions-menu-dropdown" ref={dropdownRef}>
              {menuItems.map((item, index) => {
                if ('header' in item && item.header) {
                  return (
                    <div key={index} className="context-menu-header">
                      {item.label}
                    </div>
                  );
                }

                if ('divider' in item && item.divider) {
                  return <div key={index} className="context-menu-divider" />;
                }

                const menuItem = item as {
                  actionId?: string;
                  label: string;
                  icon?: React.ReactNode;
                  onClick?: () => void;
                  disabled?: boolean;
                  danger?: boolean;
                };

                return (
                  <div
                    key={index}
                    className={`context-menu-item${menuItem.disabled ? ' disabled' : ''}${menuItem.danger ? ' danger' : ''}`}
                    role="menuitem"
                    aria-disabled={menuItem.disabled ? 'true' : 'false'}
                    data-context-action-id={menuItem.actionId}
                    onClick={() => {
                      if (!menuItem.disabled && menuItem.onClick) {
                        setIsOpen(false);
                        menuItem.onClick();
                      }
                    }}
                  >
                    {menuItem.icon && <span className="context-menu-icon">{menuItem.icon}</span>}
                    <span className="context-menu-label">{menuItem.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* All action modals (confirm/scale/scale-to-zero/port-forward/rollback)
            are owned by the shared controller. */}
        {objectActions.modals}
      </>
    );
  }
);

ActionsMenu.displayName = 'ActionsMenu';
