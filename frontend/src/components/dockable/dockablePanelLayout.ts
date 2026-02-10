/**
 * frontend/src/components/dockable/dockablePanelLayout.ts
 *
 * UI component for dockablePanelLayout.
 * Handles rendering and interactions for the shared components.
 */

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

// Read the CSS token so drag/resizes match the combined header + tab strip height.
const parseCssPixelValue = (raw: string, fallback: number): number => {
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getAppTopOffset = (): number => {
  if (typeof document === 'undefined') {
    return LAYOUT.APP_HEADER_HEIGHT;
  }
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--app-content-top');
  return parseCssPixelValue(raw, LAYOUT.APP_HEADER_HEIGHT);
};

/** Default panel size constraints (matches Object Panel values). */
export const PANEL_DEFAULTS = {
  DEFAULT_WIDTH: 700,
  DEFAULT_HEIGHT: 600,
  MIN_WIDTH: 500,
  MIN_HEIGHT: 400,
} as const;

export interface PanelSizeConstraints {
  minWidth: number;
  minHeight: number;
  maxWidth: number | undefined;
  maxHeight: number | undefined;
}

/**
 * Read size-constraint CSS custom properties from a panel element.
 * Falls back to PANEL_DEFAULTS when the element is unavailable (JSDOM / SSR).
 */
export function getPanelSizeConstraints(panel?: HTMLElement | null): PanelSizeConstraints {
  if (typeof document === 'undefined' || !panel) {
    return {
      minWidth: PANEL_DEFAULTS.MIN_WIDTH,
      minHeight: PANEL_DEFAULTS.MIN_HEIGHT,
      maxWidth: undefined,
      maxHeight: undefined,
    };
  }
  const style = getComputedStyle(panel);
  const readOpt = (prop: string): number | undefined => {
    const raw = style.getPropertyValue(prop).trim();
    if (!raw) return undefined;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  return {
    minWidth: readOpt('--dockable-panel-min-width') ?? PANEL_DEFAULTS.MIN_WIDTH,
    minHeight: readOpt('--dockable-panel-min-height') ?? PANEL_DEFAULTS.MIN_HEIGHT,
    maxWidth: readOpt('--dockable-panel-max-width'),
    maxHeight: readOpt('--dockable-panel-max-height'),
  };
}

export const getDockablePanelTopOffset = (panel?: HTMLElement | null): number => {
  if (typeof document === 'undefined') {
    return LAYOUT.APP_HEADER_HEIGHT;
  }
  if (panel) {
    const raw = getComputedStyle(panel).getPropertyValue('--dockable-panel-top-offset');
    return parseCssPixelValue(raw, getAppTopOffset());
  }
  return getAppTopOffset();
};
