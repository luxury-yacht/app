/*
 * dockablePanelLayout.ts
 *
 * Shared layout constants and helpers for dockable panel sizing/positioning.
 */

export const LAYOUT = {
  /** Minimum distance panels should maintain from window edges */
  MIN_EDGE_DISTANCE: 50,
  /** Margin to leave when constraining panel size to window */
  WINDOW_MARGIN: 100,
  /** Approximate width of the sidebar for layout calculations */
  SIDEBAR_WIDTH: 250,
  /** Space reserved for header and content when bottom-docked */
  BOTTOM_RESERVED_HEIGHT: 150,
  /** Height of the app header */
  APP_HEADER_HEIGHT: 45,
  /** Size of the resize detection zone on panel edges */
  RESIZE_EDGE_SIZE: 8,
  /** Size of the resize detection zone on top edge (smaller to avoid header conflict) */
  RESIZE_TOP_EDGE_SIZE: 4,
  /** Debounce delay for window resize handling */
  RESIZE_DEBOUNCE_MS: 100,
} as const;

// Read the CSS token so drag/resizes match the actual header height.
export const getAppHeaderHeight = (): number => {
  if (typeof document === 'undefined') {
    return LAYOUT.APP_HEADER_HEIGHT;
  }
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--app-header-height');
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : LAYOUT.APP_HEADER_HEIGHT;
};
