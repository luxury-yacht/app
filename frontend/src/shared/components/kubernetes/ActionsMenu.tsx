/**
 * frontend/src/shared/components/kubernetes/ActionsMenu.tsx
 *
 * UI component for ActionsMenu.
 * Handles rendering and interactions for the shared components.
 */

import React, { useState, useRef, useEffect } from 'react';
import { RestartIcon, ScaleIcon, DeleteIcon, PortForwardIcon } from '@shared/components/icons/MenuIcons';
import { PortForwardModal, PortForwardTarget } from '@modules/port-forward';
import '../ContextMenu.css';
import './ActionsMenu.css';

interface ActionsMenuProps {
  kind?: string;
  objectKind?: string;
  canRestart?: boolean;
  canScale?: boolean;
  canDelete?: boolean;
  canTrigger?: boolean;
  canSuspend?: boolean;
  canPortForward?: boolean;
  portForwardTarget?: PortForwardTarget | null;
  isSuspended?: boolean;
  restartDisabledReason?: string;
  scaleDisabledReason?: string;
  deleteDisabledReason?: string;
  currentReplicas?: number;
  actionLoading?: boolean;
  deleteLoading?: boolean;
  onRestart?: () => void;
  onScale?: (replicas: number) => void;
  onDelete?: () => void;
  onTrigger?: () => void;
  onSuspendToggle?: () => void;
  onPortForward?: () => void;
}

export const ActionsMenu = React.memo<ActionsMenuProps>(
  ({
    kind,
    objectKind: objectKind,
    canRestart,
    canScale,
    canDelete,
    canTrigger,
    canSuspend,
    canPortForward,
    portForwardTarget,
    isSuspended,
    restartDisabledReason,
    scaleDisabledReason,
    deleteDisabledReason,
    currentReplicas = 1,
    actionLoading,
    deleteLoading,
    onRestart,
    onScale,
    onDelete,
    onTrigger,
    onSuspendToggle,
    onPortForward,
  }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [showScaleModal, setShowScaleModal] = useState(false);
    const [showTriggerConfirm, setShowTriggerConfirm] = useState(false);
    const [showPortForwardModal, setShowPortForwardModal] = useState(false);
    const [scaleValue, setScaleValue] = useState(0);
    const menuRef = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

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

    const showRestartOption = !!canRestart || Boolean(restartDisabledReason);
    const showScaleOption = !!canScale || Boolean(scaleDisabledReason);
    const showDeleteOption = !!canDelete || Boolean(deleteDisabledReason);
    const showTriggerOption = !!canTrigger;
    const showSuspendOption = !!canSuspend;
    const showPortForwardOption = !!canPortForward;

    // Don't render if no actions available at all
    if (
      !showRestartOption &&
      !showScaleOption &&
      !showDeleteOption &&
      !showTriggerOption &&
      !showSuspendOption &&
      !showPortForwardOption
    ) {
      return null;
    }

    const handleRestart = () => {
      setIsOpen(false);
      if (canRestart) {
        onRestart?.();
      }
    };

    const handleScaleClick = () => {
      setIsOpen(false);
      if (!canScale) {
        return;
      }
      setScaleValue(currentReplicas);
      setShowScaleModal(true);
    };

    const handleScaleApply = () => {
      setShowScaleModal(false);
      onScale?.(scaleValue);
    };

    const handleScaleCancel = () => {
      setShowScaleModal(false);
    };

    const handleDelete = () => {
      setIsOpen(false);
      if (canDelete) {
        onDelete?.();
      }
    };

    const handleTriggerClick = () => {
      setIsOpen(false);
      setShowTriggerConfirm(true);
    };

    const handleTriggerConfirm = () => {
      setShowTriggerConfirm(false);
      onTrigger?.();
    };

    const handleSuspendToggle = () => {
      setIsOpen(false);
      onSuspendToggle?.();
    };

    const handlePortForward = () => {
      setIsOpen(false);
      if (canPortForward) {
        setShowPortForwardModal(true);
        onPortForward?.();
      }
    };

    const isLoading = actionLoading || deleteLoading;

    return (
      <>
        <div className="actions-menu" ref={menuRef}>
          <button
            className="actions-menu-button"
            onClick={() => setIsOpen(!isOpen)}
            disabled={isLoading}
            title="Actions"
            aria-label="Actions menu"
          >
            <span className="actions-menu-icon">⋯</span>
          </button>

          {isOpen && (
            <div className="context-menu actions-menu-dropdown" ref={dropdownRef}>
              {showTriggerOption && (
                <div
                  className={`context-menu-item ${actionLoading || isSuspended ? 'disabled' : ''}`}
                  role="menuitem"
                  aria-disabled={actionLoading || isSuspended ? 'true' : 'false'}
                  onClick={() => {
                    if (!actionLoading && !isSuspended) {
                      handleTriggerClick();
                    }
                  }}
                  title={isSuspended ? 'Cannot trigger suspended CronJob' : undefined}
                >
                  <span className="context-menu-icon">▶</span>
                  <span className="context-menu-label">Trigger Now</span>
                </div>
              )}

              {showSuspendOption && (
                <div
                  className={`context-menu-item ${actionLoading ? 'disabled' : ''}`}
                  role="menuitem"
                  aria-disabled={actionLoading ? 'true' : 'false'}
                  onClick={() => {
                    if (!actionLoading) {
                      handleSuspendToggle();
                    }
                  }}
                >
                  <span className="context-menu-icon">{isSuspended ? '▶' : '⏸'}</span>
                  <span className="context-menu-label">{isSuspended ? 'Resume' : 'Suspend'}</span>
                </div>
              )}

              {showPortForwardOption && (
                <div
                  className={`context-menu-item ${actionLoading ? 'disabled' : ''}`}
                  role="menuitem"
                  aria-disabled={actionLoading ? 'true' : 'false'}
                  onClick={() => {
                    if (!actionLoading) {
                      handlePortForward();
                    }
                  }}
                >
                  <span className="context-menu-icon">
                    <PortForwardIcon />
                  </span>
                  <span className="context-menu-label">Port Forward...</span>
                </div>
              )}

              {showRestartOption && (
                <div
                  className={`context-menu-item ${!canRestart || actionLoading ? 'disabled' : ''}`}
                  role="menuitem"
                  aria-disabled={!canRestart || actionLoading ? 'true' : 'false'}
                  onClick={() => {
                    if (canRestart && !actionLoading) {
                      handleRestart();
                    }
                  }}
                  title={!canRestart ? restartDisabledReason : undefined}
                >
                  <span className="context-menu-icon">
                    <RestartIcon />
                  </span>
                  <span className="context-menu-label">
                    {actionLoading ? 'Restarting...' : 'Restart'}
                  </span>
                  {!canRestart && restartDisabledReason && (
                    <span className="context-menu-reason">{restartDisabledReason}</span>
                  )}
                </div>
              )}

              {showScaleOption && (
                <div
                  className={`context-menu-item ${!canScale || actionLoading ? 'disabled' : ''}`}
                  role="menuitem"
                  aria-disabled={!canScale || actionLoading ? 'true' : 'false'}
                  onClick={() => {
                    if (canScale && !actionLoading) {
                      handleScaleClick();
                    }
                  }}
                  title={!canScale ? scaleDisabledReason : undefined}
                >
                  <span className="context-menu-icon">
                    <ScaleIcon />
                  </span>
                  <span className="context-menu-label">Scale</span>
                  {!canScale && scaleDisabledReason && (
                    <span className="context-menu-reason">{scaleDisabledReason}</span>
                  )}
                </div>
              )}

              {showDeleteOption && (
                <>
                  {(showRestartOption ||
                    showScaleOption ||
                    showTriggerOption ||
                    showSuspendOption) && <div className="context-menu-divider" />}
                  <div
                    className={`context-menu-item danger ${!canDelete || deleteLoading ? 'disabled' : ''}`}
                    role="menuitem"
                    aria-disabled={!canDelete || deleteLoading ? 'true' : 'false'}
                    onClick={() => {
                      if (canDelete && !deleteLoading) {
                        handleDelete();
                      }
                    }}
                    title={!canDelete ? deleteDisabledReason : undefined}
                  >
                    <span className="context-menu-icon">
                      <DeleteIcon />
                    </span>
                    <span className="context-menu-label">
                      {deleteLoading ? 'Deleting...' : 'Delete'}
                    </span>
                    {!canDelete && deleteDisabledReason && (
                      <span className="context-menu-reason">{deleteDisabledReason}</span>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Scale Modal */}
        {showScaleModal && (
          <div className="modal-overlay" onClick={handleScaleCancel}>
            <div className="modal-container scale-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Scale {objectKind || kind}</h2>
              </div>
              <div className="scale-modal-body">
                <label htmlFor="scale-replicas">Number of replicas:</label>
                <div className="scale-input-group">
                  <button
                    className="scale-spinner-btn"
                    onClick={() => setScaleValue(Math.max(0, scaleValue - 1))}
                    disabled={scaleValue === 0}
                    type="button"
                  >
                    −
                  </button>
                  <input
                    id="scale-replicas"
                    type="number"
                    min="0"
                    max="100"
                    value={scaleValue}
                    onChange={(e) => setScaleValue(parseInt(e.target.value) || 0)}
                    className="scale-input"
                    placeholder="0"
                    autoFocus
                  />
                  <button
                    className="scale-spinner-btn"
                    onClick={() => setScaleValue(Math.min(100, scaleValue + 1))}
                    disabled={scaleValue >= 100}
                    type="button"
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="scale-modal-footer">
                <button
                  className="button cancel"
                  onClick={handleScaleCancel}
                  disabled={actionLoading}
                >
                  Cancel
                </button>
                <button
                  className="button warning"
                  onClick={handleScaleApply}
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Scaling...' : 'Scale'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Trigger CronJob Modal */}
        {showTriggerConfirm && (
          <div className="modal-overlay" onClick={() => setShowTriggerConfirm(false)}>
            <div className="modal-container" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Trigger CronJob</h2>
              </div>
              <div className="modal-body">
                <p>Create a new Job from this CronJob immediately?</p>
              </div>
              <div className="modal-footer">
                <button
                  className="button cancel"
                  onClick={() => setShowTriggerConfirm(false)}
                  disabled={actionLoading}
                >
                  Cancel
                </button>
                <button
                  className="button primary"
                  onClick={handleTriggerConfirm}
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Triggering...' : 'Trigger'}
                </button>
              </div>
            </div>
          </div>
        )}

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
