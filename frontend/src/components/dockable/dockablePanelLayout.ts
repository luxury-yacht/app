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
  /** Minimum distance panels should maintain from content edges */
  MIN_EDGE_DISTANCE: 50,
  /** Margin to leave when constraining panel size to content area */
  WINDOW_MARGIN: 100,
  /** Size of the resize detection zone on panel edges */
  RESIZE_EDGE_SIZE: 8,
  /** Size of the resize detection zone on top edge (smaller to avoid header conflict) */
  RESIZE_TOP_EDGE_SIZE: 4,
  /** Debounce delay for resize handling */
  RESIZE_DEBOUNCE_MS: 100,
} as const;

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

/**
 * Return the bounding rect of the `.content` element in CSS-pixel space.
 * When the browser zoom is not 100%, divide by the zoomFactor so that all
 * coordinates stay in CSS pixels (consistent with panel size/position values).
 * Falls back to the full viewport if `.content` is not found (e.g. tests / SSR).
 */
export interface ContentBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function getContentBounds(zoomFactor = 1): ContentBounds {
  if (typeof document === 'undefined') {
    return { left: 0, top: 0, width: 800, height: 600 };
  }
  const el = document.querySelector('.content');
  if (el) {
    const rect = el.getBoundingClientRect();
    return {
      left: rect.left / zoomFactor,
      top: rect.top / zoomFactor,
      width: rect.width / zoomFactor,
      height: rect.height / zoomFactor,
    };
  }
  // Fallback: use full viewport dimensions.
  return {
    left: 0,
    top: 0,
    width: window.innerWidth / zoomFactor,
    height: window.innerHeight / zoomFactor,
  };
}
