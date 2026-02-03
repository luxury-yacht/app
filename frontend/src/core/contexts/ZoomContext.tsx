/**
 * frontend/src/core/contexts/ZoomContext.tsx
 *
 * Manages application zoom level (50% - 200%).
 * Applies CSS zoom to document and listens for zoom events from menu.
 */
import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';

// Zoom constraints
const MIN_ZOOM = 50;
const MAX_ZOOM = 200;
const ZOOM_STEP = 10;
const DEFAULT_ZOOM = 100;

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

  // Apply zoom to document
  const applyZoom = useCallback((level: number) => {
    document.documentElement.style.zoom = `${level}%`;
  }, []);

  // Zoom actions
  const zoomIn = useCallback(() => {
    setZoomLevel((prev) => {
      const next = Math.min(prev + ZOOM_STEP, MAX_ZOOM);
      applyZoom(next);
      return next;
    });
  }, [applyZoom]);

  const zoomOut = useCallback(() => {
    setZoomLevel((prev) => {
      const next = Math.max(prev - ZOOM_STEP, MIN_ZOOM);
      applyZoom(next);
      return next;
    });
  }, [applyZoom]);

  const resetZoom = useCallback(() => {
    setZoomLevel(DEFAULT_ZOOM);
    applyZoom(DEFAULT_ZOOM);
  }, [applyZoom]);

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
