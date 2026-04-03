/**
 * frontend/src/ui/favorites/FavMenuDropdown.tsx
 *
 * Dropdown menu triggered by a heart icon button in the app header.
 * Lists all saved favorites with hover actions for reordering, renaming,
 * and deleting. Clicking a favorite navigates to the saved view state.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FavoriteOutlineIcon } from '@shared/components/icons/MenuIcons';
import { useFavorites } from '@core/contexts/FavoritesContext';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useViewState } from '@core/contexts/ViewStateContext';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import { isAllNamespaces } from '@modules/namespace/constants';
import type { Favorite } from '@/core/persistence/favorites';
import { navigateToFavorite } from './navigateToFavorite';
import './FavMenuDropdown.css';

// ---------------------------------------------------------------------------
// Inline SVG icons — small type indicators and hover-action icons.
// Sourced from the FavoritesPrototypes reference component.
// ---------------------------------------------------------------------------

function GenericIcon({ width = 14, height = 14 }: { width?: number; height?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      width={width}
      height={height}
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="4 3"
      />
    </svg>
  );
}

function PinIcon({ width = 14, height = 14 }: { width?: number; height?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      width={width}
      height={height}
    >
      <path d="M17 4a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v2.5L5.5 8 4 9.5V12h7v8l1 1 1-1v-8h7V9.5L18.5 8 17 6.5V4z" />
    </svg>
  );
}

/** Returns a dashed-circle for generic favorites or a pin for cluster-specific ones. */
function TypeIcon({ clusterSelection }: { clusterSelection: string }) {
  return (
    <span className="fav-dropdown-type-icon">
      {clusterSelection ? <PinIcon /> : <GenericIcon />}
    </span>
  );
}

// Hover action icons (chevron up/down, pencil, trash).

function ChevronUpIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      width={13}
      height={13}
    >
      <path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      width={13}
      height={13}
    >
      <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      width={13}
      height={13}
    >
      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      width={13}
      height={13}
    >
      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const FavMenuDropdown: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const anchorRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const { favorites, updateFavorite, deleteFavorite, reorderFavorites, setPendingFavorite } =
    useFavorites();
  const kubeconfigCtx = useKubeconfig();
  const viewState = useViewState();
  const namespaceCtx = useNamespace();

  // Close the dropdown when clicking outside.
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setRenamingId(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Focus the rename input when entering rename mode.
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const toggleOpen = useCallback(() => {
    setIsOpen((prev) => !prev);
    setRenamingId(null);
  }, []);

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
    setRenamingId(null);
  }, []);

  // -- Rename --

  const startRename = useCallback((fav: Favorite) => {
    setRenamingId(fav.id);
    setRenameValue(fav.name);
  }, []);

  const commitRename = useCallback(
    async (fav: Favorite) => {
      const trimmed = renameValue.trim();
      if (trimmed && trimmed !== fav.name) {
        await updateFavorite({ ...fav, name: trimmed });
      }
      setRenamingId(null);
    },
    [renameValue, updateFavorite]
  );

  const cancelRename = useCallback(() => {
    setRenamingId(null);
  }, []);

  // -- Reorder --

  const moveUp = useCallback(
    async (index: number) => {
      if (index <= 0) return;
      const ids = favorites.map((f) => f.id);
      [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
      await reorderFavorites(ids);
    },
    [favorites, reorderFavorites]
  );

  const moveDown = useCallback(
    async (index: number) => {
      if (index >= favorites.length - 1) return;
      const ids = favorites.map((f) => f.id);
      [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
      await reorderFavorites(ids);
    },
    [favorites, reorderFavorites]
  );

  // -- Delete --

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteFavorite(id);
    },
    [deleteFavorite]
  );

  // -- Navigate --

  const handleNavigate = useCallback(
    (fav: Favorite) => {
      navigateToFavorite(
        fav,
        {
          selectedKubeconfigs: kubeconfigCtx.selectedKubeconfigs,
          setSelectedKubeconfigs: kubeconfigCtx.setSelectedKubeconfigs,
          setActiveKubeconfig: kubeconfigCtx.setActiveKubeconfig,
          setViewType: viewState.setViewType,
          setActiveClusterView: viewState.setActiveClusterView,
          setActiveNamespaceTab: viewState.setActiveNamespaceTab,
          setSelectedNamespace: namespaceCtx.setSelectedNamespace,
          onNamespaceSelect: viewState.onNamespaceSelect,
          setSidebarSelection: viewState.setSidebarSelection,
          setPendingFavorite,
        },
        closeDropdown
      );
    },
    [kubeconfigCtx, viewState, namespaceCtx, closeDropdown, setPendingFavorite]
  );

  // Determine whether a generic favorite's namespace exists on the active cluster.
  // Generic favorites are disabled when their namespace isn't available.
  const isDisabled = useCallback(
    (fav: Favorite): boolean => {
      if (fav.clusterSelection !== '') return false;
      if (fav.viewType !== 'namespace' || !fav.namespace) return false;
      // The synthetic "All Namespaces" scope is always available.
      if (isAllNamespaces(fav.namespace)) return false;
      const ns = namespaceCtx.namespaces;
      return ns.length > 0 && !ns.some((n) => n.scope === fav.namespace || n.name === fav.namespace);
    },
    [namespaceCtx.namespaces]
  );

  return (
    <div className="fav-dropdown-anchor" ref={anchorRef}>
      <button
        className="settings-button"
        onClick={toggleOpen}
        title="Favorites"
        aria-label="Favorites"
      >
        <FavoriteOutlineIcon width={20} height={20} />
      </button>

      {isOpen && (
        <div className="fav-dropdown-panel" role="menu">
          {/* Item list */}
          <div className="fav-dropdown-items">
            {favorites.length === 0 ? (
              <div className="fav-dropdown-empty">
                No favorites yet. Click the heart icon on any view to save it.
              </div>
            ) : (
              favorites.map((fav, idx) => {
                const isActive = false;
                const disabled = isDisabled(fav);
                const isRenaming = renamingId === fav.id;

                return (
                  <div
                    key={fav.id}
                    className={
                      'fav-dropdown-row' +
                      (isActive ? ' active' : '') +
                      (disabled ? ' disabled' : '') +
                      (isRenaming ? ' renaming' : '')
                    }
                    role="menuitem"
                    onClick={() => {
                      if (!disabled && !isRenaming) handleNavigate(fav);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (!disabled) startRename(fav);
                    }}
                  >
                    <TypeIcon clusterSelection={fav.clusterSelection} />

                    {isRenaming ? (
                      <input
                        ref={renameInputRef}
                        className="fav-dropdown-rename-input"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void commitRename(fav);
                          if (e.key === 'Escape') cancelRename();
                        }}
                        onBlur={() => void commitRename(fav)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="fav-dropdown-name">{fav.name}</span>
                    )}

                    <span className="fav-dropdown-hover-actions">
                      <button
                        className={`fav-dropdown-action-btn${idx === 0 ? ' disabled' : ''}`}
                        title="Move up"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (idx > 0) void moveUp(idx);
                        }}
                      >
                        <ChevronUpIcon />
                      </button>
                      <button
                        className={`fav-dropdown-action-btn${idx === favorites.length - 1 ? ' disabled' : ''}`}
                        title="Move down"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (idx < favorites.length - 1) void moveDown(idx);
                        }}
                      >
                        <ChevronDownIcon />
                      </button>
                      <button
                        className="fav-dropdown-action-btn"
                        title="Rename"
                        onClick={(e) => {
                          e.stopPropagation();
                          startRename(fav);
                        }}
                      >
                        <PencilIcon />
                      </button>
                      <button
                        className="fav-dropdown-action-btn"
                        title="Delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDelete(fav.id);
                        }}
                      >
                        <TrashIcon />
                      </button>
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer legend */}
          <div className="fav-dropdown-footer">
            <span className="fav-dropdown-footer-item">
              <GenericIcon width={10} height={10} /> any cluster
            </span>
            <span className="fav-dropdown-footer-item">
              <PinIcon width={10} height={10} /> pinned to cluster
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default React.memo(FavMenuDropdown);
