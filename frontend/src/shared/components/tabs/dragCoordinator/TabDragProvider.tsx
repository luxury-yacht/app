/**
 * frontend/src/shared/components/tabs/dragCoordinator/TabDragProvider.tsx
 *
 * Scopes a single tab drag operation and its current payload.
 * Drop hooks own their native DOM listeners.
 *
 * `onTearOff` fires when an unconsumed drag ends outside the source
 * webview. Native panel consumers use the screen coordinates to request
 * a one-tab window transfer.
 */
import { createContext, type ReactNode, useCallback, useMemo, useRef, useState } from 'react';

import type { TabDragPayload } from './types';

interface TabDragContextValue {
  currentDrag: TabDragPayload | null;
  getCurrentDrag: () => TabDragPayload | null;
  beginDrag: (payload: TabDragPayload) => void;
  endDrag: (event?: {
    clientX: number;
    clientY: number;
    screenX: number;
    screenY: number;
    dataTransfer: DataTransfer | null;
  }) => void;
}

export const TabDragContext = createContext<TabDragContextValue>({
  currentDrag: null,
  getCurrentDrag: () => null,
  beginDrag: () => undefined,
  endDrag: () => undefined,
});

export interface TabDragProviderProps {
  children: ReactNode;
  /** Fires for an unconsumed drag that ends outside the source webview. */
  onTearOff?: (payload: TabDragPayload, cursor: { x: number; y: number }) => void;
}

export function TabDragProvider({ children, onTearOff }: Readonly<TabDragProviderProps>) {
  const [currentDrag, setCurrentDrag] = useState<TabDragPayload | null>(null);
  const lastDragRef = useRef<TabDragPayload | null>(null);
  const getCurrentDrag = useCallback(() => lastDragRef.current, []);

  const beginDrag = useCallback((payload: TabDragPayload) => {
    lastDragRef.current = payload;
    setCurrentDrag(payload);
  }, []);

  const endDrag = useCallback(
    (event?: {
      clientX: number;
      clientY: number;
      screenX: number;
      screenY: number;
      dataTransfer: DataTransfer | null;
    }) => {
      const payload = lastDragRef.current;
      if (payload && event && onTearOff && event.dataTransfer?.dropEffect === 'none') {
        const outsideClientBounds =
          event.clientX < 0 ||
          event.clientY < 0 ||
          event.clientX > window.innerWidth ||
          event.clientY > window.innerHeight;
        const webviewReportedOutsideOrigin =
          event.clientX === 0 &&
          event.clientY === 0 &&
          (event.screenX !== 0 || event.screenY !== 0);
        if (outsideClientBounds || webviewReportedOutsideOrigin) {
          onTearOff(payload, { x: event.screenX, y: event.screenY });
        }
      }
      lastDragRef.current = null;
      setCurrentDrag(null);
    },
    [onTearOff]
  );

  const value = useMemo<TabDragContextValue>(
    () => ({
      currentDrag,
      getCurrentDrag,
      beginDrag,
      endDrag,
    }),
    [currentDrag, getCurrentDrag, beginDrag, endDrag]
  );

  return <TabDragContext.Provider value={value}>{children}</TabDragContext.Provider>;
}
