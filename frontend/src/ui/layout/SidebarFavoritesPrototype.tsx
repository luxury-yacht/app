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
  /** If set, this is a cluster-specific favorite. If null, it's generic. */
  clusterName: string | null;
  viewType: 'namespace' | 'cluster';
  view: string;
  namespace?: string;
  hasFilters?: boolean;
}

interface SidebarFavoritesPrototypeProps {
  favorites: FavoriteItem[];
  activeFavoriteId?: string | null;
  defaultCollapsed?: boolean;
}

/** Generic favorite icon — dashed circle (applies to any cluster). */
function GenericIcon({ width = 14, height = 14 }: { width?: number; height?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      width={width}
      height={height}
      style={{ flexShrink: 0, opacity: 0.5 }}
    >
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
    </svg>
  );
}

/** Cluster-specific favorite icon — pin (pinned to a cluster). */
function PinIcon({ width = 14, height = 14 }: { width?: number; height?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      width={width}
      height={height}
      style={{ flexShrink: 0, opacity: 0.5 }}
    >
      <path d="M17 4a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v2.5L5.5 8 4 9.5V12h7v8l1 1 1-1v-8h7V9.5L18.5 8 17 6.5V4z" />
    </svg>
  );
}

export function SidebarFavoritesPrototype({
  favorites,
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
              title={fav.name}
            >
              {fav.clusterName ? <PinIcon /> : <GenericIcon />}
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {fav.name}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
