/**
 * frontend/src/shared/components/tabs/dragCoordinator/TabDragProvider.tsx
 *
 * Scopes a single tab drag operation. Holds the current payload and a
 * registry of drop targets. Built on HTML5 native drag events.
 *
 * `onTearOff` fires when an unconsumed drag ends outside the source
 * webview. Native panel consumers use the screen coordinates to request
 * a one-tab window transfer.
 */
import { createContext, type ReactNode, useCallback, useMemo, useRef, useState } from 'react';

import type { TabDragPayload } from './types';

export interface DropTargetRegistration {
  element: HTMLElement;
  accepts: ReadonlyArray<TabDragPayload['kind']>;
  onDrop: (payload: TabDragPayload, event: DragEvent) => void;
  onDragEnter?: (payload: TabDragPayload) => void;
  onDragLeave?: () => void;
}

interface TabDragContextValue {
  currentDrag: TabDragPayload | null;
  beginDrag: (payload: TabDragPayload) => void;
  endDrag: (event?: {
    clientX: number;
    clientY: number;
    screenX: number;
    screenY: number;
    dataTransfer: DataTransfer | null;
  }) => void;
  registerTarget: (id: number, registration: DropTargetRegistration) => void;
  unregisterTarget: (id: number) => void;
}

export const TabDragContext = createContext<TabDragContextValue>({
  currentDrag: null,
  beginDrag: () => undefined,
  endDrag: () => undefined,
  registerTarget: () => undefined,
  unregisterTarget: () => undefined,
});

export interface TabDragProviderProps {
  children: ReactNode;
  /** Fires for an unconsumed drag that ends outside the source webview. */
  onTearOff?: (payload: TabDragPayload, cursor: { x: number; y: number }) => void;
}

export function TabDragProvider({ children, onTearOff }: Readonly<TabDragProviderProps>) {
  const [currentDrag, setCurrentDrag] = useState<TabDragPayload | null>(null);
  const targetsRef = useRef<Map<number, DropTargetRegistration>>(new Map());
  const lastDragRef = useRef<TabDragPayload | null>(null);

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

  const registerTarget = useCallback((id: number, registration: DropTargetRegistration) => {
    targetsRef.current.set(id, registration);
  }, []);

  const unregisterTarget = useCallback((id: number) => {
    targetsRef.current.delete(id);
  }, []);

  const value = useMemo<TabDragContextValue>(
    () => ({
      currentDrag,
      beginDrag,
      endDrag,
      registerTarget,
      unregisterTarget,
    }),
    [currentDrag, beginDrag, endDrag, registerTarget, unregisterTarget]
  );

  return <TabDragContext.Provider value={value}>{children}</TabDragContext.Provider>;
}
