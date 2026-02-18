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

/** Default panel size and per-dock-mode min constraints. */
export const PANEL_DEFAULTS = {
  DEFAULT_WIDTH: 700,
  DEFAULT_HEIGHT: 600,
  RIGHT_MIN_WIDTH: 450,
  BOTTOM_MIN_HEIGHT: 200,
  FLOATING_MIN_WIDTH: 450,
  FLOATING_MIN_HEIGHT: 200,
} as const;

/** Per-dock-mode minimum size constraints. */
export interface PanelSizeConstraints {
  right: { minWidth: number };
  bottom: { minHeight: number };
  floating: { minWidth: number; minHeight: number };
}

/**
 * Read per-dock-mode size-constraint CSS custom properties from a panel element.
 * Falls back to PANEL_DEFAULTS when the element is unavailable (JSDOM / SSR).
 */
export function getPanelSizeConstraints(panel?: HTMLElement | null): PanelSizeConstraints {
  if (typeof document === 'undefined' || !panel) {
    return {
      right: { minWidth: PANEL_DEFAULTS.RIGHT_MIN_WIDTH },
      bottom: { minHeight: PANEL_DEFAULTS.BOTTOM_MIN_HEIGHT },
      floating: {
        minWidth: PANEL_DEFAULTS.FLOATING_MIN_WIDTH,
        minHeight: PANEL_DEFAULTS.FLOATING_MIN_HEIGHT,
      },
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
    right: {
      minWidth: readOpt('--dockable-panel-right-min-width') ?? PANEL_DEFAULTS.RIGHT_MIN_WIDTH,
    },
    bottom: {
      minHeight: readOpt('--dockable-panel-bottom-min-height') ?? PANEL_DEFAULTS.BOTTOM_MIN_HEIGHT,
    },
    floating: {
      minWidth: readOpt('--dockable-panel-floating-min-width') ?? PANEL_DEFAULTS.FLOATING_MIN_WIDTH,
      minHeight:
        readOpt('--dockable-panel-floating-min-height') ?? PANEL_DEFAULTS.FLOATING_MIN_HEIGHT,
    },
  };
}

/**
 * Return the bounding rect of the `.content` element in CSS-pixel space.
 *
 * getBoundingClientRect() already returns CSS coordinates (zoom-adjusted),
 * so no zoom conversion is needed — same pattern as Tooltip and ContextMenu.
 * Only the window.innerWidth/Height fallback needs division by zoomFactor
 * because those values are in unzoomed/visual coordinates.
 *
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
    // getBoundingClientRect values are already in CSS coordinate space —
    // no zoom conversion needed (see ZoomContext docs).
    const rect = el.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }
  // Fallback: window dimensions are unzoomed, convert to CSS space.
  return {
    left: 0,
    top: 0,
    width: window.innerWidth / zoomFactor,
    height: window.innerHeight / zoomFactor,
  };
}
