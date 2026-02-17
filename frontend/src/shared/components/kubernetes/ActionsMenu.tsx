/**
 * frontend/src/shared/components/kubernetes/ActionsMenu.tsx
 *
 * Actions menu for the Object Panel. Renders a dropdown menu with available
 * actions for the current object. Uses the shared useObjectActions hook.
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useObjectActions, type ObjectActionData } from '@shared/hooks/useObjectActions';
import { PortForwardModal, type PortForwardTarget } from '@modules/port-forward';
import ScaleModal from '@shared/components/modals/ScaleModal';
import ConfirmationModal from '@components/modals/ConfirmationModal';
import '../ContextMenu.css';
import './ActionsMenu.css';

interface ActionsMenuProps {
  object: ObjectActionData | null;
  currentReplicas?: number;
  actionLoading?: boolean;
  // Whether a HorizontalPodAutoscaler manages this workload (disables Scale)
  hpaManaged?: boolean;
  onRestart?: () => void;
  onScale?: (replicas: number) => void;
  onDelete?: () => void;
  onTrigger?: () => void;
  onSuspendToggle?: () => void;
}

export const ActionsMenu = React.memo<ActionsMenuProps>(
  ({
    object,
    currentReplicas = 1,
    actionLoading = false,
    hpaManaged = false,
    onRestart,
    onScale,
    onDelete,
    onTrigger,
    onSuspendToggle,
  }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [showScaleModal, setShowScaleModal] = useState(false);
    const [showTriggerConfirm, setShowTriggerConfirm] = useState(false);
    const [showPortForwardModal, setShowPortForwardModal] = useState(false);
    const [scaleValue, setScaleValue] = useState(0);
    const menuRef = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Build handlers that open modals or call callbacks
    const handlers = useMemo(
      () => ({
        onRestart: onRestart
          ? () => {
              setIsOpen(false);
              onRestart();
            }
          : undefined,
        onScale: onScale
          ? () => {
              setIsOpen(false);
              setScaleValue(currentReplicas);
              setShowScaleModal(true);
            }
          : undefined,
        onDelete: onDelete
          ? () => {
              setIsOpen(false);
              onDelete();
            }
          : undefined,
        onTrigger: onTrigger
          ? () => {
              setIsOpen(false);
              setShowTriggerConfirm(true);
            }
          : undefined,
        onSuspendToggle: onSuspendToggle
          ? () => {
              setIsOpen(false);
              onSuspendToggle();
            }
          : undefined,
        onPortForward: () => {
          setIsOpen(false);
          setShowPortForwardModal(true);
        },
      }),
      [onRestart, onScale, onDelete, onTrigger, onSuspendToggle, currentReplicas]
    );

    // Merge hpaManaged flag into the object data for the actions hook.
    const actionObject = useMemo(
      () => (object ? { ...object, hpaManaged: hpaManaged || object.hpaManaged } : null),
      [object, hpaManaged]
    );

    // Get menu items from shared hook
    const menuItems = useObjectActions({
      object: actionObject,
      context: 'object-panel',
      handlers,
      actionLoading,
    });

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

    // Build a stable port-forward target to avoid unnecessary modal resets.
    const portForwardTarget: PortForwardTarget | null = useMemo(() => {
      if (!object) {
        return null;
      }
      return {
        kind: object.kind,
        name: object.name,
        namespace: object.namespace || '',
        clusterId: object.clusterId || '',
        clusterName: object.clusterName || '',
        ports: [],
      };
    }, [object]);

    // Don't render if no actions available
    if (menuItems.length === 0) {
      return null;
    }

    const handleScaleApply = () => {
      setShowScaleModal(false);
      onScale?.(scaleValue);
    };

    const handleTriggerConfirm = () => {
      setShowTriggerConfirm(false);
      onTrigger?.();
    };

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
                    onClick={() => {
                      if (!menuItem.disabled && menuItem.onClick) {
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

        {/* Scale Modal */}
        <ScaleModal
          isOpen={showScaleModal}
          kind={object?.kind || ''}
          name={object?.name}
          namespace={object?.namespace}
          value={scaleValue}
          loading={actionLoading}
          onCancel={() => setShowScaleModal(false)}
          onApply={handleScaleApply}
          onValueChange={setScaleValue}
        />

        {/* Trigger CronJob Confirmation */}
        <ConfirmationModal
          isOpen={showTriggerConfirm}
          title="Trigger CronJob"
          message={`Create a new Job from CronJob "${object?.name}" immediately?`}
          confirmText="Trigger"
          cancelText="Cancel"
          onConfirm={handleTriggerConfirm}
          onCancel={() => setShowTriggerConfirm(false)}
        />

        {/* Port Forward Modal */}
        {showPortForwardModal && portForwardTarget && (
          <PortForwardModal
            target={portForwardTarget}
            onClose={() => setShowPortForwardModal(false)}
          />
        )}
      </>
    );
  }
);

ActionsMenu.displayName = 'ActionsMenu';
