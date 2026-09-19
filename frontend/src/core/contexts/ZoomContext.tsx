/**
 * frontend/src/core/contexts/ZoomContext.tsx
 *
 * Manages application zoom level (50% - 200%).
 * Applies CSS zoom to app content and listens for zoom events from menu.
 * Persists zoom level to backend settings.
 */

import type React from 'react';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { readZoomLevel, requestAppState } from '@/core/app-state-access';
import { SetZoomLevel } from '@/core/backend-api';
import { onEvent } from '@/core/desktop-runtime';
import { reportOperationalError } from '@/utils/errorHandler';

// Zoom constraints
const MIN_ZOOM = 50;
const MAX_ZOOM = 200;
const ZOOM_STEP = 10;
const DEFAULT_ZOOM = 100;

/**
 * Viewport dimensions adjusted for CSS zoom.
 * Window dimensions and clientX/Y remain in viewport pixels. Divide those
 * values by the zoom factor when positioning content inside the zoomed body.
 * This interface provides the available dimensions in that content space.
 */
export interface ZoomAwareViewport {
  /** Viewport width in CSS pixels (zoomed coordinate space) */
  width: number;
  /** Viewport height in CSS pixels (zoomed coordinate space) */
  height: number;
  /** Current zoom factor (zoomLevel / 100) */
  zoomFactor: number;
}

/**
 * Get viewport dimensions adjusted for CSS zoom level.
 * Use this when you need to constrain positions/sizes to the visible viewport
 * and the constraint calculations involve mouse coordinates or CSS positioning.
 *
 * @param zoomLevel - The current zoom level (50-200, where 100 is 100%)
 * @returns Viewport dimensions in CSS pixels
 */
export function getZoomAwareViewport(zoomLevel: number): ZoomAwareViewport {
  const zoomFactor = zoomLevel / 100;
  return {
    width: window.innerWidth / zoomFactor,
    height: window.innerHeight / zoomFactor,
    zoomFactor,
  };
}

interface ZoomContextType {
  zoomLevel: number;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
}

const ZoomContext = createContext<ZoomContextType | undefined>(undefined);

export const useZoom = () => {
  const context = useContext(ZoomContext);
  if (!context) {
    throw new Error('useZoom must be used within ZoomProvider');
  }
  return context;
};

interface ZoomProviderProps {
  children: ReactNode;
}

export const ZoomProvider: React.FC<ZoomProviderProps> = ({ children }) => {
  const [zoomLevel, setZoomLevel] = useState(DEFAULT_ZOOM);
  // Menu commands can arrive before React renders the previous command.
  const currentZoom = useRef({ level: DEFAULT_ZOOM, changedByUser: false });

  // Keep the root viewport unscaled: Wails compares its client dimensions with
  // mouse coordinates to distinguish resize edges from native scrollbars.
  // The body includes app content and portaled menus, dialogs, and panels.
  const applyZoom = useCallback((level: number) => {
    currentZoom.current.level = level;
    setZoomLevel(level);
    document.body.style.zoom = `${level}%`;
    document.documentElement.style.setProperty('--app-zoom-factor', `${level / 100}`);
  }, []);

  const commitZoom = useCallback(
    (level: number) => {
      currentZoom.current.changedByUser = true;
      applyZoom(level);
      SetZoomLevel(level).catch((err) => {
        reportOperationalError(err, { source: 'ZoomContext', action: 'persistZoomLevel' });
      });
    },
    [applyZoom]
  );

  // Load initial zoom level from backend
  useEffect(() => {
    let active = true;
    requestAppState({
      resource: 'zoom-level',
      read: () => readZoomLevel(),
    })
      .then((level) => {
        if (!active || currentZoom.current.changedByUser) {
          return;
        }
        const validLevel = level >= MIN_ZOOM && level <= MAX_ZOOM ? level : DEFAULT_ZOOM;
        applyZoom(validLevel);
      })
      .catch((err) => {
        if (!active) {
          return;
        }
        reportOperationalError(err, { source: 'ZoomContext', action: 'loadZoomLevel' });
        if (!currentZoom.current.changedByUser) {
          applyZoom(DEFAULT_ZOOM);
        }
      });
    return () => {
      active = false;
    };
  }, [applyZoom]);

  const zoomIn = useCallback(() => {
    commitZoom(Math.min(currentZoom.current.level + ZOOM_STEP, MAX_ZOOM));
  }, [commitZoom]);

  const zoomOut = useCallback(() => {
    commitZoom(Math.max(currentZoom.current.level - ZOOM_STEP, MIN_ZOOM));
  }, [commitZoom]);

  const resetZoom = useCallback(() => {
    commitZoom(DEFAULT_ZOOM);
  }, [commitZoom]);

  // Listen for zoom events from Wails menu
  useEffect(() => {
    const disposeZoomIn = onEvent('zoom-in', zoomIn);
    const disposeZoomOut = onEvent('zoom-out', zoomOut);
    const disposeZoomReset = onEvent('zoom-reset', resetZoom);

    return () => {
      disposeZoomIn();
      disposeZoomOut();
      disposeZoomReset();
    };
  }, [zoomIn, zoomOut, resetZoom]);

  const canZoomIn = zoomLevel < MAX_ZOOM;
  const canZoomOut = zoomLevel > MIN_ZOOM;

  return (
    <ZoomContext.Provider
      value={{
        zoomLevel,
        zoomIn,
        zoomOut,
        resetZoom,
        canZoomIn,
        canZoomOut,
      }}
    >
      {children}
    </ZoomContext.Provider>
  );
};
