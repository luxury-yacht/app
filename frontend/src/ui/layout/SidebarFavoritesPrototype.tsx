/**
 * frontend/src/ui/layout/SidebarFavoritesPrototype.tsx
 *
 * Prototype component for the Favorites sidebar section.
 * Used in Storybook stories only — not part of the production build.
 * Renders a collapsible favorites section using the real sidebar CSS classes.
 */

import React, { useState } from 'react';
import { CategoryIcon } from '@shared/components/icons/MenuIcons';

export interface FavoriteItem {
  id: string;
  name: string;
  clusterName: string;
  viewType: 'namespace' | 'cluster';
  view: string;
  namespace?: string;
  hasFilters?: boolean;
}

interface SidebarFavoritesPrototypeProps {
  favorites: FavoriteItem[];
  /** Show cluster badge on each item (when favorites span multiple clusters). */
  showClusterBadges?: boolean;
  /** ID of the currently active favorite (highlighted). */
  activeFavoriteId?: string | null;
  /** Initially collapsed? */
  defaultCollapsed?: boolean;
}

const FavoriteStarIcon: React.FC<{ width?: number; height?: number }> = ({
  width = 14,
  height = 14,
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    width={width}
    height={height}
  >
    <path d="M12 1L15.09 7.26L22 8.27L17 13.14L18.18 20.02L12 16.77L5.82 20.02L7 13.14L2 8.27L8.91 7.26L12 1Z" />
  </svg>
);

const ChevronIcon: React.FC<{ expanded: boolean; width?: number; height?: number }> = ({
  expanded,
  width = 12,
  height = 12,
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    width={width}
    height={height}
    style={{
      transition: 'transform 150ms ease',
      transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
    }}
  >
    <path d="M9.29 6.71a1 1 0 0 0 0 1.41L13.17 12l-3.88 3.88a1 1 0 1 0 1.41 1.41l4.59-4.59a1 1 0 0 0 0-1.41L10.7 6.71a1 1 0 0 0-1.41 0z" />
  </svg>
);

export function SidebarFavoritesPrototype({
  favorites,
  showClusterBadges = false,
  activeFavoriteId = null,
  defaultCollapsed = false,
}: SidebarFavoritesPrototypeProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  if (favorites.length === 0) {
    return null;
  }

  return (
    <div className="sidebar-section" style={{ marginBottom: '0.5rem' }}>
      <h3
        onClick={() => setCollapsed((prev) => !prev)}
        style={{ cursor: 'pointer', userSelect: 'none' }}
      >
        Favorites
      </h3>
      {!collapsed && (
        <div className="cluster-items">
          {favorites.map((fav) => (
            <div
              key={fav.id}
              className={`sidebar-item${activeFavoriteId === fav.id ? ' active' : ''}`}
              data-sidebar-focusable="true"
              data-sidebar-target-kind="favorite"
              tabIndex={-1}
              style={{ gap: '0.4rem' }}
            >
              <CategoryIcon width={14} height={14} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {fav.name}
              </span>
              {showClusterBadges && (
                <span
                  style={{
                    fontSize: '0.65rem',
                    padding: '0.05rem 0.35rem',
                    borderRadius: '3px',
                    background: 'var(--color-bg-tertiary)',
                    color: 'var(--color-text-secondary)',
                    fontWeight: 500,
                    letterSpacing: '0.02em',
                    flexShrink: 0,
                    lineHeight: 1.4,
                  }}
                >
                  {fav.clusterName}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
