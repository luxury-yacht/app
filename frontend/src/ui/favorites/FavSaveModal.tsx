/**
 * frontend/src/ui/favorites/FavSaveModal.tsx
 *
 * Modal for saving, updating, or deleting a favorite.
 * Shows the favorite name, cluster binding choice, and a read-only
 * summary of the view and filter state being bookmarked.
 */

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useShortcut, useKeyboardContext } from '@ui/shortcuts';
import { useModalFocusTrap } from '@shared/components/modals/useModalFocusTrap';
import { KeyboardContextPriority, KeyboardScopePriority } from '@ui/shortcuts/priorities';
import { CloseIcon } from '@shared/components/icons/MenuIcons';
import ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import type { Favorite, FavoriteFilters, FavoriteTableState } from '@/core/persistence/favorites';
import '@ui/modals/modals.css';
import './FavSaveModal.css';

export interface FavSaveModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The existing favorite being edited, or null when creating a new one. */
  existingFavorite: Favorite | null;
  /** Auto-generated default name for a new favorite. */
  defaultName: string;
  /** Current cluster context name. */
  clusterName: string;
  /** Current kubeconfig selection string (used as clusterSelection for cluster-specific). */
  kubeconfigSelection: string;
  /** "cluster" or "namespace". */
  viewType: string;
  /** The active view tab label (e.g. "Pods", "Nodes"). */
  viewLabel: string;
  /** Current namespace (empty for cluster views). */
  namespace: string;
  /** Snapshot of current filter state. */
  filters: FavoriteFilters;
  /** Snapshot of current table state. */
  tableState: FavoriteTableState;
  /** Whether the include-metadata toggle is active. */
  includeMetadata: boolean;
  /** Called to save (add or update) the favorite. */
  onSave: (fav: Favorite) => void;
  /** Called to delete the favorite (only when editing an existing one). */
  onDelete: (id: string) => void;
}

const FavSaveModal: React.FC<FavSaveModalProps> = ({
  isOpen,
  onClose,
  existingFavorite,
  defaultName,
  clusterName,
  kubeconfigSelection,
  viewType,
  viewLabel,
  namespace,
  filters,
  tableState,
  includeMetadata,
  onSave,
  onDelete,
}) => {
  const isEditing = existingFavorite != null;
  const [name, setName] = useState('');
  const [clusterSpecific, setClusterSpecific] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const { pushContext, popContext } = useKeyboardContext();
  const contextPushedRef = useRef(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // Initialize form state when the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    if (existingFavorite) {
      setName(existingFavorite.name);
      setClusterSpecific(existingFavorite.clusterSelection !== '');
    } else {
      setName(defaultName);
      setClusterSpecific(true);
    }
    setShowDeleteConfirm(false);
  }, [isOpen, existingFavorite, defaultName]);

  // Keyboard context management.
  useEffect(() => {
    if (!isOpen) {
      if (contextPushedRef.current) {
        popContext();
        contextPushedRef.current = false;
      }
      return;
    }
    pushContext({ priority: KeyboardContextPriority.SETTINGS_MODAL });
    contextPushedRef.current = true;
    return () => {
      if (contextPushedRef.current) {
        popContext();
        contextPushedRef.current = false;
      }
    };
  }, [isOpen, popContext, pushContext]);

  useShortcut({
    key: 'Escape',
    handler: () => {
      if (!isOpen) return false;
      onClose();
      return true;
    },
    description: 'Close favorite modal',
    category: 'Modals',
    enabled: isOpen && !showDeleteConfirm,
    view: 'global',
    priority: KeyboardContextPriority.SETTINGS_MODAL,
  });

  useModalFocusTrap({
    ref: modalRef,
    focusableSelector: '[data-fav-modal-focusable="true"]',
    priority: KeyboardScopePriority.SETTINGS_MODAL,
    disabled: !isOpen || showDeleteConfirm,
  });

  const handleSave = () => {
    const fav: Favorite = {
      id: existingFavorite?.id ?? '',
      name: name.trim() || defaultName,
      clusterSelection: clusterSpecific ? kubeconfigSelection : '',
      viewType,
      view: existingFavorite?.view ?? '',
      namespace: existingFavorite?.namespace ?? namespace,
      filters: { ...filters, includeMetadata },
      tableState,
      order: existingFavorite?.order ?? 0,
    };
    onSave(fav);
    onClose();
  };

  const handleDelete = () => {
    setShowDeleteConfirm(true);
  };

  const confirmDelete = () => {
    if (existingFavorite) {
      onDelete(existingFavorite.id);
    }
    setShowDeleteConfirm(false);
    onClose();
  };

  if (!isOpen) return null;

  const hasFilterText = filters.search.trim().length > 0;
  const scopeLabel = viewType === 'namespace' ? 'Namespaced' : 'Cluster';

  return createPortal(
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div
          className="modal-container fav-save-modal"
          onClick={(e) => e.stopPropagation()}
          ref={modalRef}
        >
          <div className="modal-header">
            <h2>{isEditing ? 'Edit Favorite' : 'Save Favorite'}</h2>
            <button
              className="modal-close"
              onClick={onClose}
              aria-label="Close"
              data-fav-modal-focusable="true"
            >
              <CloseIcon />
            </button>
          </div>

          <div className="modal-content">
            {/* Name field */}
            <div className="fav-save-field">
              <label className="fav-save-label" htmlFor="fav-name">Name</label>
              <input
                id="fav-name"
                type="text"
                className="fav-save-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                onKeyDown={(e) => {
                  // Allow standard text editing shortcuts to reach the input
                  // before the app's keyboard shortcut system intercepts them.
                  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
                    e.preventDefault();
                    (e.target as HTMLInputElement).select();
                  }
                }}
                autoFocus
                data-fav-modal-focusable="true"
              />
            </div>

            {/* Cluster binding */}
            <div className="fav-save-field">
              <span className="fav-save-label">Cluster Binding</span>
              <div className="fav-save-radios">
                <label className="fav-save-radio">
                  <input
                    type="radio"
                    name="cluster-binding"
                    checked={clusterSpecific}
                    onChange={() => setClusterSpecific(true)}
                    data-fav-modal-focusable="true"
                  />
                  <span>Cluster-specific ({clusterName})</span>
                </label>
                <label className="fav-save-radio">
                  <input
                    type="radio"
                    name="cluster-binding"
                    checked={!clusterSpecific}
                    onChange={() => setClusterSpecific(false)}
                    data-fav-modal-focusable="true"
                  />
                  <span>Any Cluster</span>
                </label>
              </div>
            </div>

            {/* Description of what's being bookmarked */}
            <div className="fav-save-details">
              <div className="fav-save-detail-row">
                <span className="fav-save-detail-label">Cluster</span>
                <span className="fav-save-detail-value">
                  {clusterSpecific ? clusterName : 'Any'}
                </span>
              </div>
              <div className="fav-save-detail-row">
                <span className="fav-save-detail-label">Scope</span>
                <span className="fav-save-detail-value">{scopeLabel}</span>
              </div>
              <div className="fav-save-detail-row">
                <span className="fav-save-detail-label">View</span>
                <span className="fav-save-detail-value">{viewLabel}</span>
              </div>
              {namespace && viewType === 'namespace' && (
                <div className="fav-save-detail-row">
                  <span className="fav-save-detail-label">Namespace</span>
                  <span className="fav-save-detail-value">{namespace}</span>
                </div>
              )}
              <div className="fav-save-detail-row">
                <span className="fav-save-detail-label">Filter Text</span>
                <span className="fav-save-detail-value">
                  {hasFilterText ? filters.search : '(none)'}
                </span>
              </div>
              <div className="fav-save-detail-row">
                <span className="fav-save-detail-label">Case-Sensitive</span>
                <input
                  type="checkbox"
                  checked={filters.caseSensitive}
                  disabled
                  className="fav-save-checkbox"
                />
              </div>
              <div className="fav-save-detail-row">
                <span className="fav-save-detail-label">Include Metadata</span>
                <input
                  type="checkbox"
                  checked={includeMetadata}
                  disabled
                  className="fav-save-checkbox"
                />
              </div>
            </div>
          </div>

          <div className="modal-footer">
            {isEditing && (
              <button
                className="modal-btn modal-btn-danger"
                onClick={handleDelete}
                data-fav-modal-focusable="true"
              >
                Delete
              </button>
            )}
            <div className="fav-save-footer-spacer" />
            <button
              className="modal-btn modal-btn-secondary"
              onClick={onClose}
              data-fav-modal-focusable="true"
            >
              Cancel
            </button>
            <button
              className="modal-btn modal-btn-primary"
              onClick={handleSave}
              data-fav-modal-focusable="true"
            >
              Save
            </button>
          </div>
        </div>
      </div>

      <ConfirmationModal
        isOpen={showDeleteConfirm}
        title="Delete Favorite"
        message={`Delete "${name}"? This cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        confirmButtonClass="danger"
        onConfirm={confirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </>,
    document.body
  );
};

export default FavSaveModal;
