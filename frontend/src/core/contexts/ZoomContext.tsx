/**
 * frontend/src/core/contexts/ZoomContext.tsx
 *
 * Manages application zoom level (50% - 200%).
 * Applies CSS zoom to document and listens for zoom events from menu.
 * Persists zoom level to backend settings.
 */
import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from 'react';
import { GetZoomLevel, SetZoomLevel } from '@wailsjs/go/backend/App';

// Zoom constraints
const MIN_ZOOM = 50;
const MAX_ZOOM = 200;
const ZOOM_STEP = 10;
const DEFAULT_ZOOM = 100;

/**
 * Viewport dimensions adjusted for CSS zoom.
 * When CSS zoom is applied, window.innerWidth/Height return unzoomed dimensions,
 * but mouse coordinates (clientX/Y) and CSS positioning are in zoomed space.
 * This interface provides dimensions in the zoomed coordinate space.
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

/**
 * Hook that provides zoom-aware viewport dimensions.
 * Combines useZoom with getZoomAwareViewport for convenient use in components.
 */
export const useZoomAwareViewport = (): ZoomAwareViewport => {
  const { zoomLevel } = useZoom();
  return getZoomAwareViewport(zoomLevel);
};

interface ZoomProviderProps {
  children: ReactNode;
}

export const ZoomProvider: React.FC<ZoomProviderProps> = ({ children }) => {
  const [zoomLevel, setZoomLevel] = useState(DEFAULT_ZOOM);

  // Apply zoom to document
  const applyZoom = useCallback((level: number) => {
    document.documentElement.style.zoom = `${level}%`;
  }, []);

  // Persist zoom level to backend
  const persistZoom = useCallback((level: number) => {
    SetZoomLevel(level).catch((err) => {
      console.error('Failed to persist zoom level:', err);
    });
  }, []);

  // Load initial zoom level from backend
  useEffect(() => {
    GetZoomLevel()
      .then((level) => {
        const validLevel = level >= MIN_ZOOM && level <= MAX_ZOOM ? level : DEFAULT_ZOOM;
        setZoomLevel(validLevel);
        applyZoom(validLevel);
      })
      .catch((err) => {
        console.error('Failed to load zoom level:', err);
        applyZoom(DEFAULT_ZOOM);
      });
  }, [applyZoom]);

  // Zoom actions
  const zoomIn = useCallback(() => {
    setZoomLevel((prev) => {
      const next = Math.min(prev + ZOOM_STEP, MAX_ZOOM);
      applyZoom(next);
      persistZoom(next);
      return next;
    });
  }, [applyZoom, persistZoom]);

  const zoomOut = useCallback(() => {
    setZoomLevel((prev) => {
      const next = Math.max(prev - ZOOM_STEP, MIN_ZOOM);
      applyZoom(next);
      persistZoom(next);
      return next;
    });
  }, [applyZoom, persistZoom]);

  const resetZoom = useCallback(() => {
    setZoomLevel(DEFAULT_ZOOM);
    applyZoom(DEFAULT_ZOOM);
    persistZoom(DEFAULT_ZOOM);
  }, [applyZoom, persistZoom]);

  // Listen for zoom events from Wails menu
  useEffect(() => {
    const runtime = window.runtime;
    if (!runtime?.EventsOn) {
      return;
    }

    runtime.EventsOn('zoom-in', zoomIn);
    runtime.EventsOn('zoom-out', zoomOut);
    runtime.EventsOn('zoom-reset', resetZoom);

    return () => {
      runtime.EventsOff?.('zoom-in');
      runtime.EventsOff?.('zoom-out');
      runtime.EventsOff?.('zoom-reset');
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
