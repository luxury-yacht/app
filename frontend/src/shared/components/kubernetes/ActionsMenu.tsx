/**
 * frontend/src/shared/components/kubernetes/ActionsMenu.tsx
 *
 * UI component for ActionsMenu.
 * Handles rendering and interactions for the shared components.
 */

import React, { useState, useRef, useEffect } from 'react';
import './ActionsMenu.css';

interface ActionsMenuProps {
  kind?: string;
  objectKind?: string;
  canRestart?: boolean;
  canScale?: boolean;
  canDelete?: boolean;
  restartDisabledReason?: string;
  scaleDisabledReason?: string;
  deleteDisabledReason?: string;
  currentReplicas?: number;
  actionLoading?: boolean;
  deleteLoading?: boolean;
  onRestart?: () => void;
  onScale?: (replicas: number) => void;
  onDelete?: () => void;
}

export const ActionsMenu = React.memo<ActionsMenuProps>(
  ({
    kind,
    objectKind: objectKind,
    canRestart,
    canScale,
    canDelete,
    restartDisabledReason,
    scaleDisabledReason,
    deleteDisabledReason,
    currentReplicas = 1,
    actionLoading,
    deleteLoading,
    onRestart,
    onScale,
    onDelete,
  }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [showScaleModal, setShowScaleModal] = useState(false);
    const [scaleValue, setScaleValue] = useState(0);
    const menuRef = useRef<HTMLDivElement>(null);

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

    const showRestartOption = !!canRestart || Boolean(restartDisabledReason);
    const showScaleOption = !!canScale || Boolean(scaleDisabledReason);
    const showDeleteOption = !!canDelete || Boolean(deleteDisabledReason);

    // Don't render if no actions available at all
    if (!showRestartOption && !showScaleOption && !showDeleteOption) {
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
            <div className="actions-menu-dropdown">
              {showRestartOption && (
                <button
                  className="actions-menu-item"
                  onClick={handleRestart}
                  disabled={!canRestart || actionLoading}
                  title={!canRestart ? restartDisabledReason : undefined}
                >
                  <span className="actions-menu-item-label">
                    {actionLoading ? 'Restarting...' : 'Restart'}
                  </span>
                  {!canRestart && restartDisabledReason && (
                    <span className="actions-menu-reason">{restartDisabledReason}</span>
                  )}
                </button>
              )}

              {showScaleOption && (
                <button
                  className="actions-menu-item"
                  onClick={handleScaleClick}
                  disabled={!canScale || actionLoading}
                  title={!canScale ? scaleDisabledReason : undefined}
                >
                  <span className="actions-menu-item-label">Scale</span>
                  {!canScale && scaleDisabledReason && (
                    <span className="actions-menu-reason">{scaleDisabledReason}</span>
                  )}
                </button>
              )}

              {showDeleteOption && (
                <>
                  {(showRestartOption || showScaleOption) && (
                    <div className="actions-menu-divider" />
                  )}
                  <button
                    className="actions-menu-item danger"
                    onClick={handleDelete}
                    disabled={!canDelete || deleteLoading}
                    title={!canDelete ? deleteDisabledReason : undefined}
                  >
                    <span className="actions-menu-item-label">
                      {deleteLoading ? 'Deleting...' : 'Delete'}
                    </span>
                    {!canDelete && deleteDisabledReason && (
                      <span className="actions-menu-reason">{deleteDisabledReason}</span>
                    )}
                  </button>
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
      </>
    );
  }
);

ActionsMenu.displayName = 'ActionsMenu';
