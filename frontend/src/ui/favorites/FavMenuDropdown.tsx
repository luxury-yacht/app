/**
 * frontend/src/ui/favorites/FavMenuDropdown.tsx
 *
 * Dropdown menu triggered by a heart icon button in the app header.
 * Lists all saved favorites with hover actions for reordering, renaming,
 * and deleting. Clicking a favorite navigates to the saved view state.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  FavoriteFilledIcon,
  FavoriteGenericIcon,
  FavoritePinIcon,
} from '@shared/components/icons/MenuIcons';
import { useFavorites } from '@core/contexts/FavoritesContext';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import { isAllNamespaces } from '@modules/namespace/constants';
import type { Favorite } from '@/core/persistence/favorites';
import { navigateToFavorite } from './navigateToFavorite';
import './FavMenuDropdown.css';

// ---------------------------------------------------------------------------
// Inline SVG icons — hover-action icons.
// ---------------------------------------------------------------------------

/** Returns a dashed-circle for generic favorites or a pin for cluster-specific ones. */
function TypeIcon({ clusterSelection }: { clusterSelection: string }) {
  return (
    <span className="fav-dropdown-type-icon">
      {clusterSelection ? <FavoritePinIcon /> : <FavoriteGenericIcon />}
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

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const FavMenuDropdown: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  const { favorites, reorderFavorites, setPendingFavorite } = useFavorites();
  const kubeconfigCtx = useKubeconfig();
  const namespaceCtx = useNamespace();

  // Close the dropdown when clicking outside.
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const toggleOpen = useCallback(() => setIsOpen((prev) => !prev), []);
  const closeDropdown = useCallback(() => setIsOpen(false), []);

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

  // -- Navigate --

  const handleNavigate = useCallback(
    (fav: Favorite) => {
      navigateToFavorite(
        fav,
        {
          selectedKubeconfigs: kubeconfigCtx.selectedKubeconfigs,
          setSelectedKubeconfigs: kubeconfigCtx.setSelectedKubeconfigs,
          setActiveKubeconfig: kubeconfigCtx.setActiveKubeconfig,
          setPendingFavorite,
        },
        closeDropdown
      );
    },
    [kubeconfigCtx, closeDropdown, setPendingFavorite]
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
      return (
        ns.length > 0 && !ns.some((n) => n.scope === fav.namespace || n.name === fav.namespace)
      );
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
        <FavoriteFilledIcon width={18} height={18} />
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
                const disabled = isDisabled(fav);

                return (
                  <div
                    key={fav.id}
                    className={'fav-dropdown-row' + (disabled ? ' disabled' : '')}
                    role="menuitem"
                    onClick={() => {
                      if (!disabled) handleNavigate(fav);
                    }}
                  >
                    <TypeIcon clusterSelection={fav.clusterSelection} />
                    <span className="fav-dropdown-name">{fav.name}</span>

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
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer legend */}
          <div className="fav-dropdown-footer">
            <span className="fav-dropdown-footer-item">
              <FavoriteGenericIcon width={10} height={10} /> any cluster
            </span>
            <span className="fav-dropdown-footer-item">
              <FavoritePinIcon width={10} height={10} /> pinned to cluster
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default React.memo(FavMenuDropdown);
