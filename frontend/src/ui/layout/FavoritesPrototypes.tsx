/**
 * frontend/src/ui/layout/FavoritesPrototypes.tsx
 *
 * Prototype components for Favorites design options.
 * Used in Storybook stories only — not part of the production build.
 *
 * Option B: Star menu dropdown in the header toolbar
 * Option C: Favorites integrated into the command palette
 */

import React, { useState } from 'react';
import './AppHeader.css';
import '../command-palette/CommandPalette.css';

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

// ---------------------------------------------------------------------------
// Shared icons
// ---------------------------------------------------------------------------

function GenericIcon({ width = 14, height = 14 }: { width?: number; height?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"
      width={width} height={height} style={{ flexShrink: 0, opacity: 0.5 }}>
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
    </svg>
  );
}

function PinIcon({ width = 14, height = 14 }: { width?: number; height?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"
      width={width} height={height} style={{ flexShrink: 0, opacity: 0.5 }}>
      <path d="M17 4a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v2.5L5.5 8 4 9.5V12h7v8l1 1 1-1v-8h7V9.5L18.5 8 17 6.5V4z" />
    </svg>
  );
}

function FavoritesIcon({ width = 20, height = 20 }: { width?: number; height?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"
      width={width} height={height}>
      <path d="m12 21l-1.45-1.3q-2.525-2.275-4.175-3.925T3.75 12.812T2.388 10.4T2 8.15Q2 5.8 3.575 4.225T7.5 2.65q1.3 0 2.475.55T12 4.75q.85-1 2.025-1.55t2.475-.55q2.35 0 3.925 1.575T22 8.15q0 1.15-.387 2.25t-1.363 2.412t-2.625 2.963T13.45 19.7zm0-2.7q2.4-2.15 3.95-3.687t2.45-2.675t1.25-2.026T20 8.15q0-1.5-1-2.5t-2.5-1q-1.175 0-2.175.662T12.95 7h-1.9q-.375-1.025-1.375-1.687T7.5 4.65q-1.5 0-2.5 1t-1 2.5q0 .875.35 1.763t1.25 2.025t2.45 2.675T12 18.3m0-6.825" />
    </svg>
  );
}

function TypeIcon({ clusterName }: { clusterName: string | null }) {
  return clusterName ? <PinIcon /> : <GenericIcon />;
}

// ---------------------------------------------------------------------------
// Option B: Star menu dropdown
// ---------------------------------------------------------------------------

export function StarMenuDropdown({
  favorites,
  activeFavoriteId = null,
  isOpen: controlledOpen,
}: {
  favorites: FavoriteItem[];
  activeFavoriteId?: string | null;
  isOpen?: boolean;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlledOpen ?? internalOpen;

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      {/* Star button — same style as settings button */}
      <button
        className="settings-button"
        onClick={() => setInternalOpen((prev) => !prev)}
        title="Favorites"
        aria-label="Favorites"
      >
        <FavoritesIcon />
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            width: '320px',
            maxHeight: '400px',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--border-radius-lg, 8px)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            animation: 'commandPaletteIn 150ms ease-out',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '0.6rem 0.75rem',
              borderBottom: '1px solid var(--color-border)',
              fontSize: '0.75rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--color-text-secondary)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>Favorites</span>
            <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
              {favorites.length} saved
            </span>
          </div>

          {/* Items */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0.35rem 0' }}>
            {favorites.length === 0 ? (
              <div
                style={{
                  padding: '2rem 1rem',
                  textAlign: 'center',
                  color: 'var(--color-text-secondary)',
                  fontSize: '0.8rem',
                  fontStyle: 'italic',
                }}
              >
                No favorites yet. Click the star icon on any view to save it.
              </div>
            ) : (
              favorites.map((fav) => (
                <div
                  key={fav.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.4rem 0.75rem',
                    cursor: 'pointer',
                    borderLeft: '3px solid transparent',
                    transition: 'background-color 150ms ease, border-color 150ms ease',
                    ...(activeFavoriteId === fav.id
                      ? {
                          backgroundColor: 'var(--color-bg-secondary)',
                          borderLeftColor: 'var(--color-accent)',
                        }
                      : {}),
                  }}
                  title={fav.name}
                  onMouseEnter={(e) => {
                    if (activeFavoriteId !== fav.id) {
                      e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)';
                      e.currentTarget.style.borderLeftColor = 'var(--color-border)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (activeFavoriteId !== fav.id) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.borderLeftColor = 'transparent';
                    }
                  }}
                >
                  <TypeIcon clusterName={fav.clusterName} />
                  <span
                    style={{
                      flex: 1,
                      fontSize: '0.8rem',
                      color: 'var(--color-text)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {fav.name}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              padding: '0.4rem 0.75rem',
              borderTop: '1px solid var(--color-border)',
              fontSize: '0.7rem',
              color: 'var(--color-text-secondary)',
              backgroundColor: 'var(--color-bg-secondary)',
              display: 'flex',
              gap: '0.5rem',
              alignItems: 'center',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
              <GenericIcon width={10} height={10} /> any cluster
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
              <PinIcon width={10} height={10} /> pinned to cluster
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Option C: Command palette with favorites
// ---------------------------------------------------------------------------

export function CommandPaletteWithFavorites({
  favorites,
  searchQuery = '',
  selectedIndex = 0,
}: {
  favorites: FavoriteItem[];
  searchQuery?: string;
  selectedIndex?: number;
}) {
  const [query, setQuery] = useState(searchQuery);

  // Filter favorites by query
  const filteredFavorites = query
    ? favorites.filter((f) => f.name.toLowerCase().includes(query.toLowerCase()))
    : favorites;

  // Simulated command items (non-favorite)
  const commands = [
    { label: 'Toggle Sidebar', shortcut: '⌘B', icon: '◫' },
    { label: 'Settings', shortcut: '⌘,', icon: '⚙' },
    { label: 'Refresh Current View', shortcut: '⌘R', icon: '↻' },
  ];

  const filteredCommands = query
    ? commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))
    : commands;

  let itemIndex = 0;

  return (
    <div style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center' }}>
      {/* Backdrop */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 9998,
        }}
      />

      {/* Palette */}
      <div className="command-palette" style={{ position: 'relative', zIndex: 9999, marginTop: '9vh' }}>
        <div className="command-palette-header">
          <input
            className="command-palette-input"
            type="text"
            placeholder="Type a command or search favorites..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>
        <div className="command-palette-results">
          {/* Favorites group — shown first when not searching or when matches exist */}
          {filteredFavorites.length > 0 && (
            <div className="command-palette-group">
              <div className="command-palette-group-header">Favorites</div>
              {filteredFavorites.map((fav) => {
                const thisIndex = itemIndex++;
                return (
                  <div
                    key={fav.id}
                    className={`command-palette-item${thisIndex === selectedIndex ? ' selected' : ''}`}
                  >
                    <span className="command-palette-item-icon" style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <TypeIcon clusterName={fav.clusterName} />
                    </span>
                    <div className="command-palette-item-content">
                      <div className="command-palette-item-label">{fav.name}</div>
                      {fav.clusterName && (
                        <div className="command-palette-item-description">
                          pinned to {fav.clusterName}
                          {fav.hasFilters ? ' • has filters' : ''}
                        </div>
                      )}
                      {!fav.clusterName && fav.hasFilters && (
                        <div className="command-palette-item-description">has filters</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Regular commands */}
          {filteredCommands.length > 0 && (
            <div className="command-palette-group">
              <div className="command-palette-group-header">Application</div>
              {filteredCommands.map((cmd) => {
                const thisIndex = itemIndex++;
                return (
                  <div
                    key={cmd.label}
                    className={`command-palette-item${thisIndex === selectedIndex ? ' selected' : ''}`}
                  >
                    <span className="command-palette-item-icon">{cmd.icon}</span>
                    <div className="command-palette-item-content">
                      <div className="command-palette-item-label">{cmd.label}</div>
                    </div>
                    <span
                      style={{
                        fontSize: '0.7rem',
                        color: 'var(--color-text-secondary)',
                        marginLeft: 'auto',
                        paddingLeft: '1rem',
                      }}
                    >
                      {cmd.shortcut}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {filteredFavorites.length === 0 && filteredCommands.length === 0 && (
            <div className="command-palette-empty">No matches found</div>
          )}
        </div>
        <div className="command-palette-footer">
          <span className="command-palette-hint">↑↓ navigate</span>
          <span className="command-palette-hint">↵ select</span>
          <span className="command-palette-hint">esc close</span>
        </div>
      </div>
    </div>
  );
}
