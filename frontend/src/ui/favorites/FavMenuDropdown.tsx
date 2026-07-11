/**
 * frontend/src/ui/favorites/FavMenuDropdown.tsx
 *
 * Dropdown menu triggered by a heart icon button in the app header.
 * Lists all saved favorites with hover actions for reordering.
 * Clicking a favorite navigates to the saved view state.
 */

import { useFavorites } from '@core/contexts/FavoritesContext';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { isAllNamespaces } from '@modules/namespace/constants';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  FavoriteFilledIcon,
  FavoriteGenericIcon,
  FavoritePinIcon,
} from '@shared/components/icons/FavoriteIcons';
import { DeleteIcon } from '@shared/components/icons/SharedIcons';
import { useKeyboardSurface } from '@ui/shortcuts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Favorite } from '@/core/persistence/favorites';
import { navigateToFavorite } from './navigateToFavorite';
import './FavMenuDropdown.css';

/** Returns a dashed-circle for generic favorites or a pin for cluster-specific ones. */
function TypeIcon({ clusterSelection }: { clusterSelection: string }) {
  return (
    <span className="fav-dropdown-type-icon">
      {clusterSelection ? (
        <FavoritePinIcon width={16} height={16} />
      ) : (
        <FavoriteGenericIcon width={16} height={16} />
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const FavMenuDropdown: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  const { favorites, deleteFavorite, reorderFavorites, setPendingFavorite } = useFavorites();
  const kubeconfigCtx = useKubeconfig();
  const namespaceCtx = useNamespace();

  // Close the dropdown when clicking outside.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

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

  const handleTriggerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      event.preventDefault();
      toggleOpen();
    },
    [toggleOpen]
  );

  // Register the open menu as a keyboard surface so Escape closes it, matching
  // the menu/dropdown keyboard contract (docs/frontend/keyboard.md).
  useKeyboardSurface({
    kind: 'menu',
    rootRef: anchorRef,
    active: isOpen,
    onEscape: () => {
      closeDropdown();
      return true;
    },
  });
  // -- Reorder --

  const moveUp = useCallback(
    async (index: number) => {
      if (index <= 0) {
        return;
      }
      const ids = favorites.map((f) => f.id);
      [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
      await reorderFavorites(ids);
    },
    [favorites, reorderFavorites]
  );

  const moveDown = useCallback(
    async (index: number) => {
      if (index >= favorites.length - 1) {
        return;
      }
      const ids = favorites.map((f) => f.id);
      [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
      await reorderFavorites(ids);
    },
    [favorites, reorderFavorites]
  );

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
          selectedClusterId: kubeconfigCtx.selectedClusterId,
          openKubeconfig: kubeconfigCtx.openKubeconfig,
          setActiveKubeconfig: kubeconfigCtx.setActiveKubeconfig,
          getClusterMeta: kubeconfigCtx.getClusterMeta,
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
      if (fav.clusterSelection !== '') {
        return false;
      }
      if (fav.viewType !== 'namespace' || !fav.namespace) {
        return false;
      }
      // The synthetic "All Namespaces" scope is always available.
      if (isAllNamespaces(fav.namespace)) {
        return false;
      }
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
        type="button"
        className="settings-button"
        onClick={toggleOpen}
        onKeyDown={handleTriggerKeyDown}
        title="Favorites"
        aria-label="Favorites"
      >
        <FavoriteFilledIcon width={14} height={14} />
      </button>

      {!!isOpen && (
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
                    className={`fav-dropdown-row${disabled ? ' disabled' : ''}`}
                    role="menuitem"
                    aria-disabled={disabled}
                    tabIndex={disabled ? -1 : 0}
                    onClick={() => {
                      if (!disabled) {
                        handleNavigate(fav);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.target !== event.currentTarget ||
                        (event.key !== 'Enter' && event.key !== ' ')
                      ) {
                        return;
                      }
                      event.preventDefault();
                      if (!disabled) {
                        handleNavigate(fav);
                      }
                    }}
                  >
                    <TypeIcon clusterSelection={fav.clusterSelection} />
                    <span className="fav-dropdown-name">{fav.name}</span>

                    <span className="fav-dropdown-hover-actions">
                      <button
                        type="button"
                        className={`fav-dropdown-action-btn${idx === 0 ? ' disabled' : ''}`}
                        title="Move up"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (idx > 0) {
                            void moveUp(idx);
                          }
                        }}
                      >
                        <ChevronUpIcon width={14} height={14} />
                      </button>
                      <button
                        type="button"
                        className={`fav-dropdown-action-btn${idx === favorites.length - 1 ? ' disabled' : ''}`}
                        title="Move down"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (idx < favorites.length - 1) {
                            void moveDown(idx);
                          }
                        }}
                      >
                        <ChevronDownIcon width={14} height={14} />
                      </button>
                      <button
                        type="button"
                        className="fav-dropdown-action-btn danger"
                        title="Delete favorite"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDelete(fav.id);
                        }}
                      >
                        <DeleteIcon width={14} height={14} />
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
